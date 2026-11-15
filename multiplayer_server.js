// ============================================================================
// 《蛋裡是什麼鴨：雙人連線大農場 ＆ Boss 共鬥版》
// 多人連線與雲端持久化同步核心：
// 1. Firebase Realtime Database 雲端即時資料庫（跨網路雙人同步 ＆ 帳號存檔持久化）
// 2. 本地伺服器資料庫同步 (HTTP /api/world & /api/save -> data/world_db.json)
// 3. 同機多視窗即時同步 (BroadcastChannel + localStorage)
// 4. 跨網房間備援連線 (PeerJS WebRTC P2P Server，未設定 Firebase 時使用)
// ============================================================================

const NetEngine = {
  clientId: 'C-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
  FIXED_ROOM_ID: 'DUCK-FARM-JERRY-COOP-V3',
  roomCode: 'DUCK-FARM-JERRY-COOP-V3',
  bc: null,
  peer: null,
  isHost: false,
  hostConn: null,
  clientConns: [],
  onlinePeers: {}, // { clientId: { username, plotIndex, squadPower, lastSeen } }
  hasLocalHttpServer: false,
  reconnectTimer: null,
  fbEnabled: false,
  fbDb: null,
  fbWorldRef: null,
  fbPresenceRef: null,
  fbMyPresenceRef: null,
  fbEventsRef: null,
  fbConnectedAt: 0,

  async init() {
    if ('BroadcastChannel' in window) {
      this.bc = new BroadcastChannel('clusterduck_online_world_v3');
      this.bc.onmessage = (ev) => {
        if (ev.data && ev.data.senderId !== this.clientId) {
          this.onPacketReceived(ev.data);
        }
      };
    }

    const params = new URLSearchParams(window.location.search);
    const customRoom = params.get('room');
    this.roomCode = (customRoom || this.FIXED_ROOM_ID).trim().toUpperCase().replace(/[.#$\[\]]/g, '_');

    // 優先啟用 Firebase 雲端即時資料庫（穩定跨網同步 + 伺服器端儲存帳號與領地）
    if (this.initFirebase()) {
      setInterval(() => {
        this.sendHeartbeat();
      }, 3000);
      return;
    }

    if (window.location.protocol.startsWith('http')) {
      try {
        const res = await fetch('/api/world', { cache: 'no-store' });
        if (res.ok) {
          const serverWorld = await res.json();
          this.hasLocalHttpServer = true;
          if (serverWorld && serverWorld.version === 3 && serverWorld.accounts) {
            Game.mergeServerWorld(serverWorld);
          }
          this.updateNetStatusUI('🟢 本地伺服器連線中 (自動儲存至硬碟)');
        }
      } catch (e) {
        this.hasLocalHttpServer = false;
      }
    }

    // 未設定 Firebase 時，退回 PeerJS 自動連線
    setTimeout(() => {
      this.autoConnectFixedRoom(this.roomCode);
    }, 350);

    setInterval(() => {
      this.sendHeartbeat();
      this.cleanupOfflinePeers();
    }, 1500);

    setInterval(() => {
      if (this.hasLocalHttpServer) {
        this.pollHttpServerWorld();
      }
    }, 2200);
  },

  initFirebase() {
    const cfg = window.FIREBASE_CONFIG;
    if (typeof firebase === 'undefined' || !cfg || !cfg.databaseURL || !cfg.databaseURL.trim()) {
      return false;
    }
    try {
      if (!firebase.apps || firebase.apps.length === 0) {
        firebase.initializeApp(cfg);
      }
      this.fbDb = firebase.database();
      this.fbEnabled = true;
      this.fbConnectedAt = Date.now();

      const base = `rooms/${this.roomCode}`;
      this.fbWorldRef = this.fbDb.ref(`${base}/world`);
      this.fbPresenceRef = this.fbDb.ref(`${base}/presence`);
      this.fbMyPresenceRef = this.fbPresenceRef.child(this.clientId);
      this.fbEventsRef = this.fbDb.ref(`${base}/events`);

      this.updateNetStatusUI('🟡 正在連線至 Firebase 雲端伺服器...');

      this.fbDb.ref('.info/connected').on('value', (snap) => {
        if (snap.val() === true) {
          this.fbMyPresenceRef.onDisconnect().remove();
          this.sendHeartbeat();
          this.updateNetStatusUI('🟢 Firebase 雲端伺服器連線中');
        } else {
          this.updateNetStatusUI('🟠 Firebase 斷線重連中...');
        }
      });

      this.fbWorldRef.on('value', (snap) => {
        const data = snap.val();
        if (!data || !data.json) return;
        if (data.lastWriter === this.clientId) return;
        try {
          const serverWorld = JSON.parse(data.json);
          if (serverWorld && serverWorld.version === 3 && serverWorld.accounts) {
            Game.mergeServerWorld(serverWorld);
          }
        } catch (e) {
          console.error('Firebase world parse error:', e);
        }
      });

      this.fbPresenceRef.on('value', (snap) => {
        const raw = snap.val() || {};
        const now = Date.now();
        const prevIds = new Set(Object.keys(this.onlinePeers));
        const nextPeers = {};
        Object.keys(raw).forEach((cid) => {
          if (cid === this.clientId) return;
          const p = raw[cid];
          if (p && p.username && now - (p.lastSeen || 0) < 15000) {
            nextPeers[cid] = p;
            if (!prevIds.has(cid) && typeof Game !== 'undefined') {
              Game.addLog(`👋 玩家【${p.username}】已從雲端連線進入大場地（領地 #${(p.plotIndex ?? 0) + 1}）！`);
            }
          }
        });
        this.onlinePeers = nextPeers;
        if (typeof Game !== 'undefined') {
          Game.updateOnlinePlayersUI();
        }
      });

      this.fbEventsRef.limitToLast(20).on('child_added', (snap) => {
        const packet = snap.val();
        if (!packet || packet.senderId === this.clientId) return;
        if ((packet.timestamp || 0) < this.fbConnectedAt - 3000) return;
        this.onPacketReceived(packet);
      });

      if (typeof Game !== 'undefined') {
        Game.addLog('☁️ 已連線至 Firebase 雲端伺服器！帳號與雙人領地將自動儲存在雲端。');
      }
      return true;
    } catch (e) {
      console.error('Firebase init failed:', e);
      this.fbEnabled = false;
      return false;
    }
  },

  async pollHttpServerWorld() {
    try {
      const res = await fetch('/api/world', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.version === 3 && data.lastUpdated && data.lastUpdated > (Game.world.lastUpdated || 0)) {
          Game.mergeServerWorld(data);
        }
      }
    } catch (e) {}
  },

  async saveToHttpServer(worldData) {
    if (this.fbEnabled && this.fbWorldRef && worldData) {
      try {
        await this.fbWorldRef.set({
          json: JSON.stringify(worldData),
          lastUpdated: worldData.lastUpdated || Date.now(),
          lastWriter: this.clientId
        });
      } catch (e) {
        console.error('Firebase save error:', e);
      }
    }
    if (!this.hasLocalHttpServer) return;
    try {
      await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(worldData)
      });
    } catch (e) {}
  },

  autoConnectFixedRoom(roomId) {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (typeof Peer === 'undefined') {
      this.updateNetStatusUI('🟢 本機即時同步模式');
      return;
    }

    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
    }
    this.clientConns = [];
    this.hostConn = null;
    this.updateNetStatusUI('🟡 正在自動連線雙人世界...');

    const hostPeer = new Peer(roomId);
    this.peer = hostPeer;

    hostPeer.on('open', (id) => {
      this.isHost = true;
      this.roomCode = id;
      this.updateNetStatusUI('🟡 已開房・等待夥伴上線中');
      if (typeof Game !== 'undefined') {
        Game.addLog('🌐 已自動建立固定雙人世界房間！夥伴打開網頁就會直接連進來！');
      }
    });

    hostPeer.on('connection', (conn) => {
      this.clientConns.push(conn);
      conn.on('open', () => {
        this.updateNetStatusUI('🟢 雙人即時連線中');
        if (typeof Game !== 'undefined' && Game.world) {
          conn.send({
            type: 'WORLD_SYNC',
            senderId: this.clientId,
            senderName: Game.currentUser || 'Host',
            timestamp: Date.now(),
            payload: { world: Game.world }
          });
        }
        this.sendHeartbeat();
      });

      conn.on('data', (packet) => {
        this.onPacketReceived(packet);
        this.clientConns.forEach(c => {
          if (c !== conn && c.open) c.send(packet);
        });
      });

      conn.on('close', () => {
        this.clientConns = this.clientConns.filter(c => c !== conn && c.open);
        if (this.clientConns.length === 0) {
          this.updateNetStatusUI('🟡 已開房・等待夥伴上線中');
        }
      });
    });

    hostPeer.on('error', (err) => {
      // 若房間 ID 已被另一位玩家佔用（代表夥伴已經先開好房了），自動改以訪客身分連入！
      if (err && err.type === 'unavailable-id') {
        this.connectAsFixedClient(roomId);
      } else {
        this.updateNetStatusUI('🟠 離線/重連中...');
        this.reconnectTimer = setTimeout(() => this.autoConnectFixedRoom(roomId), 3500);
      }
    });
  },

  connectAsFixedClient(roomId) {
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
    }
    this.updateNetStatusUI('🟡 偵測到夥伴在線，正在加入...');

    const clientPeer = new Peer();
    this.peer = clientPeer;

    clientPeer.on('open', () => {
      const conn = clientPeer.connect(roomId, { reliable: true });
      this.hostConn = conn;
      conn.on('open', () => {
        this.isHost = false;
        this.roomCode = roomId;
        this.updateNetStatusUI('🟢 雙人即時連線中');
        if (typeof Game !== 'undefined') {
          Game.addLog('🎉 已自動連入雙人世界！正在同步夥伴領地！');
          Game.notify('🎉 已自動連上夥伴的雙人世界！', 'success');
        }
        this.sendHeartbeat();
        this.broadcastWorldSync();
      });

      conn.on('data', (packet) => {
        if (packet && packet.senderId !== this.clientId) {
          this.onPacketReceived(packet);
        }
      });

      conn.on('close', () => {
        this.updateNetStatusUI('🟡 夥伴已離線・嘗試重新接管房間...');
        this.reconnectTimer = setTimeout(() => this.autoConnectFixedRoom(roomId), 2000);
      });
    });

    clientPeer.on('error', () => {
      this.updateNetStatusUI('🟠 連線重試中...');
      this.reconnectTimer = setTimeout(() => this.autoConnectFixedRoom(roomId), 3500);
    });
  },

  updateNetStatusUI(text) {
    const badge = document.getElementById('netStatusText');
    if (badge) badge.textContent = text;
  },

  send(type, payload = {}) {
    const packet = {
      type,
      senderId: this.clientId,
      senderName: (typeof Game !== 'undefined' && Game.currentUser) ? Game.currentUser : '訪客',
      timestamp: Date.now(),
      payload
    };

    if (this.fbEnabled) {
      if (type === 'HEARTBEAT' && this.fbMyPresenceRef) {
        this.fbMyPresenceRef.set({
          ...payload,
          lastSeen: Date.now()
        }).catch(() => {});
        return;
      }
      if (type === 'WORLD_SYNC') {
        if (payload && payload.world) {
          this.saveToHttpServer(payload.world);
        }
        return;
      }
      if (this.fbEventsRef) {
        this.fbEventsRef.push(packet).catch(() => {});
      }
    }

    if (this.bc) {
      this.bc.postMessage(packet);
    }
    if (this.isHost) {
      this.clientConns.forEach(c => {
        if (c.open) c.send(packet);
      });
    } else if (this.hostConn && this.hostConn.open) {
      this.hostConn.send(packet);
    }
  },

  sendHeartbeat() {
    if (typeof Game === 'undefined' || !Game.currentUser) return;
    this.send('HEARTBEAT', {
      clientId: this.clientId,
      username: Game.currentUser,
      plotIndex: Game.getMyPlotIndex(),
      squadPower: Game.getMySquadTotalPower()
    });
  },

  broadcastWorldSync() {
    if (typeof Game === 'undefined' || !Game.world) return;
    this.send('WORLD_SYNC', {
      world: Game.world
    });
  },

  cleanupOfflinePeers() {
    const now = Date.now();
    let changed = false;
    Object.keys(this.onlinePeers).forEach(cid => {
      if (now - this.onlinePeers[cid].lastSeen > 5000) {
        delete this.onlinePeers[cid];
        changed = true;
      }
    });
    if (changed && typeof Game !== 'undefined') {
      Game.updateOnlinePlayersUI();
    }
  },

  onPacketReceived(packet) {
    if (!packet || typeof Game === 'undefined') return;
    const { type, senderId, senderName, payload } = packet;

    switch (type) {
      case 'HEARTBEAT':
        const isFirstSeen = !this.onlinePeers[senderId];
        this.onlinePeers[senderId] = {
          clientId: senderId,
          username: payload.username,
          plotIndex: payload.plotIndex,
          squadPower: payload.squadPower || 0,
          lastSeen: Date.now()
        };
        if (isFirstSeen && payload.username) {
          Game.addLog(`👋 玩家【${payload.username}】已連線進入大場地（領地 #${(payload.plotIndex ?? 0) + 1}）！`);
        }
        Game.updateOnlinePlayersUI();
        break;

      case 'WORLD_SYNC':
        if (payload && payload.world) {
          Game.mergeServerWorld(payload.world);
        }
        break;

      case 'CHAT_LOG':
        if (payload && payload.msg) {
          Game.addLog(payload.msg, false);
        }
        break;

      case 'PIT_SACRIFICE':
        Game.onRemotePitSacrifice(senderName, payload.duck, payload.pit);
        break;

      case 'EGG_STOLEN':
        Game.onRemoteEggStolen(payload);
        break;

      case 'EGG_BLESSED':
        Game.onRemoteEggBlessed(payload);
        break;

      case 'BREED_REQUEST':
        if (payload.targetOwner === Game.currentUser) {
          Game.onReceiveBreedRequest(payload);
        }
        break;

      case 'BREED_ACCEPTED':
        if (payload.requester === Game.currentUser) {
          Game.onBreedRequestAccepted(payload);
        }
        break;

      case 'TRADE_PROPOSAL':
        if (payload.targetOwner === Game.currentUser) {
          Game.onReceiveTradeProposal(payload);
        }
        break;

      case 'TRADE_COMPLETED':
        Game.onTradeCompleted(payload);
        break;

      // ================== 組隊 Boss 共鬥與即時傷害榜同步封包 ==================
      case 'BOSS_RAID_INVITE':
        Game.onReceiveBossRaidInvite(payload);
        break;

      case 'BOSS_RAID_ACCEPT':
        Game.onRemotePlayerJoinedRaid(payload);
        break;

      case 'BOSS_RAID_START':
        Game.onRemoteBossRaidStarted(payload);
        break;

      case 'BOSS_RAID_DAMAGE':
        Game.onRemoteBossRaidDamage(payload);
        break;

      case 'BOSS_RAID_VICTORY':
        Game.onRemoteBossRaidVictory(payload);
        break;

      case 'BOSS_RAID_TIMEOUT':
        Game.onRemoteBossRaidTimeout(payload);
        break;

      case 'ACCOUNT_DELETED':
        Game.onRemoteAccountDeleted(payload);
        break;

      case 'WORLD_RESET':
        Game.onRemoteWorldReset();
        break;
    }
  }
};

window.NetEngine = NetEngine;
