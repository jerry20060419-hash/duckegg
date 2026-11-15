// ============================================================================
// 《蛋裡是什麼鴨：雙人連線大農場 ＆ Boss 共鬥版》
// 三合一多人連線與持久化同步核心：
// 1. 本地伺服器資料庫同步 (HTTP /api/world & /api/save -> data/world_db.json)
// 2. 同機多視窗即時同步 (BroadcastChannel + localStorage)
// 3. 跨網房間連線伺服器 (PeerJS WebRTC P2P Server)
// ============================================================================

const NetEngine = {
  clientId: 'C-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
  roomCode: 'DUCK-LOCAL',
  bc: null,
  peer: null,
  isHost: false,
  hostConn: null,
  clientConns: [],
  onlinePeers: {}, // { clientId: { username, plotIndex, squadPower, lastSeen } }
  hasLocalHttpServer: false,

  async init() {
    if ('BroadcastChannel' in window) {
      this.bc = new BroadcastChannel('clusterduck_online_world_v3');
      this.bc.onmessage = (ev) => {
        if (ev.data && ev.data.senderId !== this.clientId) {
          this.onPacketReceived(ev.data);
        }
      };
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

    const params = new URLSearchParams(window.location.search);
    const autoRoom = params.get('room');
    if (autoRoom) {
      setTimeout(() => {
        const inp = document.getElementById('roomCodeInput');
        if (inp) inp.value = autoRoom;
        this.joinPeerRoom(autoRoom);
      }, 800);
    }

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
    if (!this.hasLocalHttpServer) return;
    try {
      await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(worldData)
      });
    } catch (e) {}
  },

  createPeerRoom(customCode) {
    if (typeof Peer === 'undefined') {
      Game.notify('⚠️ 跨網元件載入中或離線，目前已啟用本機/區網即時同步！', 'info');
      return;
    }
    const randNum = Math.floor(1000 + Math.random() * 9000);
    const code = (customCode || ('DUCK-' + randNum)).trim().toUpperCase();

    if (this.peer) this.peer.destroy();
    this.updateNetStatusUI(`🟡 正在啟動房間 (${code})...`);

    this.peer = new Peer(code);
    this.peer.on('open', (id) => {
      this.isHost = true;
      this.roomCode = id;
      const inp = document.getElementById('roomCodeInput');
      if (inp) inp.value = id;
      this.updateNetStatusUI(`🟢 線上房主 (${id})`);
      Game.addLog(`🌐 已架設雙人連線伺服器【${id}】！把代碼傳給夥伴即可連入同一個大場地！`);
      Game.notify(`🌐 跨網伺服器【${id}】已啟動！`, 'success');
    });

    this.peer.on('connection', (conn) => {
      this.clientConns.push(conn);
      conn.on('open', () => {
        conn.send({
          type: 'WORLD_SYNC',
          senderId: this.clientId,
          senderName: Game.currentUser || 'Host',
          timestamp: Date.now(),
          payload: { world: Game.world }
        });
        this.sendHeartbeat();
      });

      conn.on('data', (packet) => {
        this.onPacketReceived(packet);
        this.clientConns.forEach(c => {
          if (c !== conn && c.open) c.send(packet);
        });
      });
    });

    this.peer.on('error', (err) => {
      this.updateNetStatusUI(`🟠 本機同步模式 (${err.type || 'Local'})`);
    });
  },

  joinPeerRoom(targetCode) {
    const clean = (targetCode || '').trim().toUpperCase();
    if (!clean) {
      Game.notify('請輸入要加入的伺服器房間代碼（例如 DUCK-1234）！', 'warn');
      return;
    }
    if (typeof Peer === 'undefined') {
      Game.notify('⚠️ 無法載入跨網元件，目前使用本機多開同步模式。', 'warn');
      return;
    }

    if (this.peer) this.peer.destroy();
    this.updateNetStatusUI(`🟡 連線至 ${clean}...`);

    this.peer = new Peer();
    this.peer.on('open', () => {
      const conn = this.peer.connect(clean, { reliable: true });
      this.hostConn = conn;
      conn.on('open', () => {
        this.isHost = false;
        this.roomCode = clean;
        this.updateNetStatusUI(`🟢 已連線 (${clean})`);
        Game.addLog(`🎉 成功連入【${clean}】雙人農場伺服器！已同步全場領地！`);
        Game.notify(`🎉 已連入伺服器【${clean}】！`, 'success');
        this.sendHeartbeat();
        this.broadcastWorldSync();
      });

      conn.on('data', (packet) => {
        if (packet && packet.senderId !== this.clientId) {
          this.onPacketReceived(packet);
        }
      });
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
        Game.onRemotePitSacrifice(senderName, payload.duck, payload.points);
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
