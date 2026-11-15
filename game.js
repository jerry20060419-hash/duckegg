// ============================================================================
// 《蛋裡是什麼鴨：雙人連線大農場 ＆ Boss 共鬥版》
// 核心邏輯：
// 1. 雙人巨型領地 (無常駐NPC)
// 2. 公母生蛋交配區 (85%雙親外觀遺傳 + 15%突變)
// 3. 鴨蛋自動孵化倒計時：非變異蛋 1 分鐘 (60秒)、變異蛋 3 分鐘 (180秒) 自動孵化
// 4. 嚴格稀有度機率控制 (不再初期狂刷紅鴨，循序漸進養成)
// 5. 雙人 3+3 聯合戰鴨小隊自動打 Boss (移除滑鼠連點攻擊，保留即時連線傷害統計榜)
// ============================================================================

const STORAGE_KEY_WORLD = 'CLUSTERDUCK_WORLD_DB_V3';
const STORAGE_KEY_LAST_USER = 'CLUSTERDUCK_LAST_USER_V3';

const Game = {
  ready: false,
  currentUser: null,
  world: null,
  selectedEntity: null,
  selectedGraffitiId: 'mustache',
  selectedBossTierId: 'boss_1',

  async init() {
    this.loadWorldFromLocal();

    WorldCanvas.init();
    await NetEngine.init();

    const savedUser = sessionStorage.getItem(STORAGE_KEY_LAST_USER) || localStorage.getItem(STORAGE_KEY_LAST_USER);
    if (savedUser && this.world.accounts[savedUser]) {
      this.loginWithAccount(savedUser, null, true);
    } else {
      this.openAuthModal();
    }

    // 每秒定時循環：
    // 1. 【💕生蛋交配區】公母交配產卵進度
    // 2. 【🪺孵化鴨窩區】非變異蛋(1分鐘) / 變異蛋(3分鐘) 倒計時自動破殼孵化
    // 3. 【⚔️3+3聯合戰隊】每秒自動攻擊 Boss 與同步傷害統計
    setInterval(() => this.tick(), 1000);
    this.ready = true;
    this.updateHUD();
    this.updateOnlinePlayersUI();
    this.updateBossDamageMeterUI();
  },

  loadWorldFromLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_WORLD);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 3) {
          this.world = parsed;
        }
      }
    } catch (e) {
      console.warn('讀取本地存檔失敗，將建立新世界', e);
    }

    if (!this.world || !this.world.accounts || !this.world.plots) {
      this.world = {
        version: 3,
        lastUpdated: Date.now(),
        accounts: {},
        plots: new Array(4).fill(null),
        pit: {
          sacrifices: {
            total: 0,
            rarePlus: 0,
            epicPlus: 0,
            legendaryOrSet: 0,
            cursedOrHighSet: 0
          }
        },
        bossRaid: {
          active: false,
          bossTierId: 'boss_1',
          bossName: '',
          bossHp: 35000,
          bossMaxHp: 35000,
          remainingSec: 90,
          hostUser: '',
          participants: {} // { username: { username, squadPower, damage, squad: [最多3隻] } }
        }
      };
    }
    this.ensurePitSacrifices();
    if (Array.isArray(this.world.plots)) {
      this.world.plots.forEach(p => {
        if (p) this.ensureBreedingRooms(p);
      });
    }
  },

  ensurePitSacrifices() {
    if (!this.world) return;
    if (!this.world.pit) this.world.pit = {};
    if (!this.world.pit.sacrifices) {
      this.world.pit.sacrifices = {
        total: 0,
        rarePlus: 0,
        epicPlus: 0,
        legendaryOrSet: 0,
        cursedOrHighSet: 0
      };
    }
    if (this.world.pit.sacrifices.cursedOrHighSet === undefined) {
      this.world.pit.sacrifices.cursedOrHighSet = 0;
    }
    return this.world.pit.sacrifices;
  },

  ensureBreedingRooms(plot) {
    if (!plot) return [];
    if (!Array.isArray(plot.breedingRooms) || plot.breedingRooms.length !== MAX_BREED_ROOMS) {
      const rooms = [
        { maleId: null, femaleId: null, elapsedSec: 0 },
        { maleId: null, femaleId: null, elapsedSec: 0 },
        { maleId: null, femaleId: null, elapsedSec: 0 }
      ];
      // 相容舊存檔的單組交配欄位
      if (plot.breederMaleId || plot.breederFemaleId) {
        rooms[0].maleId = plot.breederMaleId || null;
        rooms[0].femaleId = plot.breederFemaleId || null;
        delete plot.breederMaleId;
        delete plot.breederFemaleId;
      }
      plot.breedingRooms = rooms;
    }
    return plot.breedingRooms;
  },

  saveWorld(broadcast = true) {
    if (!this.world) return;
    this.world.lastUpdated = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY_WORLD, JSON.stringify(this.world));
    } catch (e) {}

    if (NetEngine.hasLocalHttpServer) {
      NetEngine.saveToHttpServer(this.world);
    }
    if (broadcast) {
      NetEngine.broadcastWorldSync();
    }
    this.updateHUD();
    this.updateOnlinePlayersUI();
    this.updateBossDamageMeterUI();
  },

  mergeServerWorld(incomingWorld) {
    if (!incomingWorld || incomingWorld.version !== 3 || !incomingWorld.accounts) return;

    Object.keys(incomingWorld.accounts).forEach(uname => {
      const incAcc = incomingWorld.accounts[uname];
      const curAcc = this.world.accounts[uname];
      if (!curAcc || (incAcc.updatedAt || 0) >= (curAcc.updatedAt || 0)) {
        this.world.accounts[uname] = incAcc;
      }
    });

    if (Array.isArray(incomingWorld.plots)) {
      incomingWorld.plots.forEach((incPlot, idx) => {
        if (!incPlot || !incPlot.owner) return;
        const curPlot = this.world.plots[idx];

        // 若兩個不同玩家暫時撞到同一個領地格，優先保留較早建立帳號的玩家，另一位交由下方碰撞處理搬遷到領地 #2
        if (curPlot && curPlot.owner && curPlot.owner !== incPlot.owner) {
          const curCreated = (this.world.accounts[curPlot.owner] && this.world.accounts[curPlot.owner].createdAt) || 0;
          const incCreated = (this.world.accounts[incPlot.owner] && this.world.accounts[incPlot.owner].createdAt) || 0;
          if (incCreated < curCreated) {
            // 對方比較早創立：先暫存我方原本的領地資料，等下搬到空位
            const displacedPlot = curPlot;
            this.world.plots[idx] = incPlot;
            this.ensureBreedingRooms(this.world.plots[idx]);
            const freeIdx = this.allocatePlotForNewAccount();
            displacedPlot.plotIndex = freeIdx;
            this.world.plots[freeIdx] = displacedPlot;
            if (this.world.accounts[displacedPlot.owner]) {
              this.world.accounts[displacedPlot.owner].plotIndex = freeIdx;
            }
          }
          return;
        }

        // 自己的領地由本機即時控制，不被雲端舊快照蓋回導致倒數回溯；他人領地僅在更新時間嚴格較新時才覆蓋
        const isMyOwnActivePlot = curPlot && this.currentUser && curPlot.owner === this.currentUser;
        if (!isMyOwnActivePlot && (!curPlot || (incPlot.updatedAt || 0) > (curPlot.updatedAt || 0))) {
          if (curPlot && curPlot.ducks && incPlot.ducks) {
            incPlot.ducks.forEach(nd => {
              const old = curPlot.ducks.find(od => od.id === nd.id);
              if (old && old.lx !== undefined) {
                nd.lx = old.lx; nd.ly = old.ly; nd.tx = old.tx; nd.ty = old.ty; nd.facing = old.facing;
                nd.walkPhase = old.walkPhase;
              }
            });
          }
          this.world.plots[idx] = incPlot;
          this.ensureBreedingRooms(this.world.plots[idx]);
        }
      });
    }

    this.resolvePlotCollisions();

    if (incomingWorld.pit) {
      const incPitTime = incomingWorld.pit.updatedAt || 0;
      const curPitTime = (this.world.pit && this.world.pit.updatedAt) || 0;
      if (incPitTime > curPitTime) {
        this.world.pit = incomingWorld.pit;
      }
    }
    this.ensurePitSacrifices();
    if (incomingWorld.bossRaid && (!this.world.bossRaid || (incomingWorld.bossRaid.updatedAt || 0) >= (this.world.bossRaid.updatedAt || 0))) {
      this.world.bossRaid = incomingWorld.bossRaid;
    }

    try {
      localStorage.setItem(STORAGE_KEY_WORLD, JSON.stringify(this.world));
    } catch (e) {}

    // 若登入畫面正開著，即時刷新已記錄帳號與領地編號
    const authModal = document.getElementById('authModal');
    if (authModal && !authModal.classList.contains('hidden')) {
      this.renderSavedAccountsList();
    }

    this.updateHUD();
    this.updateOnlinePlayersUI();
    this.updateBossDamageMeterUI();
  },

  // 確保每個已創建帳號擁有獨立領地（先建帳號者優先領地 #1，後加入者自動分配領地 #2）
  resolvePlotCollisions() {
    if (!this.world || !this.world.accounts) return;
    const sortedUsers = Object.values(this.world.accounts).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const usedIndices = new Set();

    sortedUsers.forEach(acc => {
      if (acc.plotIndex !== undefined && acc.plotIndex !== null && !usedIndices.has(acc.plotIndex)) {
        usedIndices.add(acc.plotIndex);
        if (this.world.plots[acc.plotIndex]) {
          this.world.plots[acc.plotIndex].plotIndex = acc.plotIndex;
        }
      } else {
        const oldIdx = acc.plotIndex;
        let newIdx = 0;
        while (usedIndices.has(newIdx) && newIdx < 3) newIdx++;
        usedIndices.add(newIdx);
        acc.plotIndex = newIdx;
        acc.updatedAt = Date.now();

        if (this.world.plots[oldIdx] && this.world.plots[oldIdx].owner === acc.username && !this.world.plots[newIdx]) {
          const moved = this.world.plots[oldIdx];
          moved.plotIndex = newIdx;
          moved.updatedAt = Date.now();
          this.world.plots[newIdx] = moved;
        }

        if (this.currentUser === acc.username) {
          WorldCanvas.focusOnPlot(newIdx, 0.72);
          this.notify(`🚚 偵測到領地已有先行玩家，已自動為您分配專屬【巨型領地 #${newIdx + 1}】！`, 'info');
        }
      }
    });
  },

  // ==========================================================================
  // 帳號註冊、登入與固定巨型領地分配（僅顯示有登入過的真實玩家，無常駐NPC）
  // ==========================================================================
  openAuthModal() {
    this.renderSavedAccountsList();
    document.getElementById('authModal').classList.remove('hidden');
    if (typeof NetEngine !== 'undefined' && NetEngine.fbEnabled) {
      NetEngine.fbPollBackup(false);
    }
  },

  renderSavedAccountsList() {
    const container = document.getElementById('savedAccountsList');
    if (!container) return;
    const names = Object.keys(this.world.accounts).sort((a, b) => {
      return (this.world.accounts[a].plotIndex ?? 99) - (this.world.accounts[b].plotIndex ?? 99);
    });
    if (names.length === 0) {
      container.innerHTML = `<div class="empty-hint">目前雲端與本機尚無已註冊的玩家帳號，請在上方輸入名稱創建你的專屬巨型鴨場！</div>`;
      return;
    }

    const onlineNames = new Set(
      Object.values(NetEngine.onlinePeers || {}).map(p => p.username).filter(Boolean)
    );

    container.innerHTML = names.map(uname => {
      const acc = this.world.accounts[uname];
      const plot = this.world.plots[acc.plotIndex];
      const duckCount = plot && plot.ducks ? plot.ducks.length : 0;
      const pwr = this.getPlotTotalPower(plot);
      const safeName = uname.replace(/'/g, "\\'");
      let statusBadge = `<span style="color:#94a3b8;font-size:11px;margin-left:6px;">☁️ 雲端已存檔</span>`;
      if (this.currentUser === uname) {
        statusBadge = `<span style="color:#4ade80;font-size:11px;margin-left:6px;">● 本機登入中</span>`;
      } else if (onlineNames.has(uname)) {
        statusBadge = `<span style="color:#22c55e;font-size:11px;margin-left:6px;">🟢 夥伴在線中</span>`;
      }
      return `
        <div class="saved-account-card" onclick="Game.quickLogin('${safeName}')">
          <div>
            <div class="acc-name">🦆 ${uname} <span class="acc-plot-tag">巨型領地 #${acc.plotIndex + 1}</span>${statusBadge}</div>
            <div class="acc-meta">💰 ${acc.coins || 0} 鴨幣 ｜ 🦆 ${duckCount} 隻鴨 ｜ ⚔️ 領地戰力 ${pwr.toLocaleString()}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <button class="btn-sm btn-gold">登入領地</button>
            <button class="btn-sm btn-danger" onclick="event.stopPropagation(); Game.deleteAccount('${safeName}')" title="刪除此帳號與領地資料">🗑️ 刪除</button>
          </div>
        </div>
      `;
    }).join('');
  },

  deleteAccount(username) {
    if (!this.world || !this.world.accounts[username]) return;
    if (!confirm(`確定要永久刪除帳號【${username}】及其領地內所有鴨子、鴨蛋與紀錄嗎？此操作無法復原！`)) {
      return;
    }

    const acc = this.world.accounts[username];
    const plotIdx = acc.plotIndex;
    delete this.world.accounts[username];
    if (this.world.plots && this.world.plots[plotIdx] && this.world.plots[plotIdx].owner === username) {
      this.world.plots[plotIdx] = null;
    }

    if (this.currentUser === username) {
      this.currentUser = null;
      sessionStorage.removeItem(STORAGE_KEY_LAST_USER);
      if (localStorage.getItem(STORAGE_KEY_LAST_USER) === username) {
        localStorage.removeItem(STORAGE_KEY_LAST_USER);
      }
      this.closeInspector();
    }

    this.saveWorld(true);
    NetEngine.send('ACCOUNT_DELETED', { username, plotIdx });
    this.renderSavedAccountsList();
    this.notify(`🗑️ 已永久刪除帳號【${username}】的領地資料！`, 'info');
  },

  onRemoteAccountDeleted(payload) {
    if (!payload || !payload.username || !this.world) return;
    const uname = payload.username;
    delete this.world.accounts[uname];
    if (this.world.plots && payload.plotIdx !== undefined && this.world.plots[payload.plotIdx] && this.world.plots[payload.plotIdx].owner === uname) {
      this.world.plots[payload.plotIdx] = null;
    }
    if (this.currentUser === uname) {
      this.currentUser = null;
      sessionStorage.removeItem(STORAGE_KEY_LAST_USER);
      localStorage.removeItem(STORAGE_KEY_LAST_USER);
      this.openAuthModal();
    }
    try { localStorage.setItem(STORAGE_KEY_WORLD, JSON.stringify(this.world)); } catch (e) {}
    this.renderSavedAccountsList();
    this.updateHUD();
    this.updateOnlinePlayersUI();
  },

  resetAllWorldData() {
    if (!confirm('⚠️ 確定要清除本機與伺服器上【所有玩家帳號】與全部領地存檔嗎？所有紀錄都會歸零！')) {
      return;
    }
    this.currentUser = null;
    sessionStorage.removeItem(STORAGE_KEY_LAST_USER);
    localStorage.removeItem(STORAGE_KEY_LAST_USER);
    localStorage.removeItem(STORAGE_KEY_WORLD);

    this.world = {
      version: 3,
      lastUpdated: Date.now(),
      accounts: {},
      plots: new Array(4).fill(null),
      pit: {
        sacrifices: {
          total: 0,
          rarePlus: 0,
          epicPlus: 0,
          legendaryOrSet: 0,
          cursedOrHighSet: 0
        }
      },
      bossRaid: {
        active: false,
        bossTierId: 'boss_1',
        bossName: '',
        bossHp: 35000,
        bossMaxHp: 35000,
        remainingSec: 90,
        hostUser: '',
        participants: {}
      }
    };

    this.saveWorld(false);
    NetEngine.send('WORLD_RESET', {});
    this.closeInspector();
    this.renderSavedAccountsList();
    this.notify('🧹 已清空所有帳號與世界存檔！', 'success');
  },

  onRemoteWorldReset() {
    this.currentUser = null;
    sessionStorage.removeItem(STORAGE_KEY_LAST_USER);
    localStorage.removeItem(STORAGE_KEY_LAST_USER);
    localStorage.removeItem(STORAGE_KEY_WORLD);
    this.loadWorldFromLocal();
    this.closeInspector();
    this.openAuthModal();
    this.updateHUD();
    this.updateOnlinePlayersUI();
  },

  quickLogin(username) {
    const acc = this.world.accounts[username];
    if (!acc) return;
    document.getElementById('authUsername').value = username;
    document.getElementById('authPin').value = acc.pin || '';
    this.submitAuthForm();
  },

  submitAuthForm() {
    const unameInput = document.getElementById('authUsername');
    const pinInput = document.getElementById('authPin');
    const username = (unameInput.value || '').trim();
    const pin = (pinInput.value || '').trim();

    if (!username) {
      this.notify('請輸入你的鴨場主人名稱！', 'warn');
      return;
    }
    if (username.length > 14) {
      this.notify('名稱請勿超過 14 個字！', 'warn');
      return;
    }

    this.loginWithAccount(username, pin, false);
  },

  loginWithAccount(username, pin, isAuto = false) {
    let acc = this.world.accounts[username];

    if (acc) {
      if (!isAuto && acc.pin && acc.pin !== pin) {
        this.notify('❌ 密碼 / PIN 碼不正確！若忘記密碼可直接從下方「本機已記錄帳號」點擊登入。', 'warn');
        return;
      }
    } else {
      const plotIndex = this.allocatePlotForNewAccount();
      // 起始僅給予普通級 (Common) 鴨子，讓稀有度養成循序漸進更有成就感！
      const dMale1 = this.createDuckObject('始祖小黃', 'h_classic', 'w_classic', 'b_classic', 1, 'M');
      const dFemale1 = this.createDuckObject('豆芽莉莉', 'h_sprout', 'w_classic', 'b_classic', 1, 'F');
      const dMale2 = this.createDuckObject('吐司阿呆', 'h_classic', 'w_classic', 'b_breakfast', 1, 'M');

      acc = {
        username,
        pin: pin || '',
        plotIndex,
        coins: 100,
        mutationLv: 1,
        maxDucks: 24,
        maxEggs: 12,
        squadIds: [dFemale1.id, dMale2.id, dMale1.id],
        unlockedParts: {
          h_classic: true, w_classic: true, b_classic: true,
          h_sprout: true, b_breakfast: true
        },
        unlockedSets: {
          classic: true
        },
        mailbox: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.world.accounts[username] = acc;

      this.world.plots[plotIndex] = {
        plotIndex,
        owner: username,
        maxDucks: 24,
        maxEggs: 12,
        breedingRooms: [
          { maleId: dMale1.id, femaleId: dFemale1.id, elapsedSec: 15 },
          { maleId: null, femaleId: null, elapsedSec: 0 },
          { maleId: null, femaleId: null, elapsedSec: 0 }
        ],
        ducks: [dMale1, dFemale1, dMale2],
        eggs: [
          {
            id: 'egg_' + Date.now() + '_init',
            rarity: 'common',
            isMutated: false,
            head: 'h_sprout',
            wing: 'w_sprout',
            body: 'b_classic',
            gen: 2,
            totalSec: HATCH_TIME_NORMAL_SEC,
            remainingSec: 30,
            parentInfo: '新手一般遺傳蛋 (1分鐘自動孵化)',
            graffiti: [],
            blessedBy: [],
            stolenBy: []
          }
        ],
        updatedAt: Date.now()
      };

      this.addLog(`🎉 歡迎飼養員【${username}】入駐巨型領地 #${plotIndex + 1}！`);
    }

    this.currentUser = username;
    sessionStorage.setItem(STORAGE_KEY_LAST_USER, username);
    localStorage.setItem(STORAGE_KEY_LAST_USER, username);

    document.getElementById('authModal').classList.add('hidden');
    this.ensureValidSquad();
    this.applyOfflineEggCountdown(this.getMyPlot());
    WorldCanvas.focusOnPlot(acc.plotIndex, 0.72);

    this.checkOfflineMailbox(acc);

    this.saveWorld(true);
    NetEngine.sendHeartbeat();
    this.notify(`🦆 歡迎回來，【${username}】！（巨型領地 #${acc.plotIndex + 1}）`, 'success');
  },

  // 離線期間繼續計算「孵蛋倒計時（到 0 停止不孵化）」與「交配室產卵計時」；上線後再由 tick() 依序孵出
  applyOfflineEggCountdown(plot) {
    if (!plot) return false;
    const now = Date.now();
    const lastTick = plot.lastTickAt || plot.updatedAt || now;
    const offlineSec = Math.max(0, Math.floor((now - lastTick) / 1000));
    let laidEgg = false;

    if (offlineSec > 0) {
      // 1. 先推進原本鴨窩裡既有鴨蛋的倒計時（只到 0 為止，不自動孵化）
      if (Array.isArray(plot.eggs)) {
        plot.eggs.forEach(egg => {
          if (egg.remainingSec === undefined) {
            egg.totalSec = egg.isMutated ? HATCH_TIME_MUTATED_SEC : HATCH_TIME_NORMAL_SEC;
            egg.remainingSec = egg.totalSec;
          }
          egg.remainingSec = Math.max(0, egg.remainingSec - offlineSec);
        });
      }

      // 2. 離線期間 3 組交配室繼續計時產卵（直到鴨窩滿額為止），新產的蛋同樣倒計時到 0 停止
      const breedTimeSec = this.getPlotBreedTimeSec(plot);
      const rooms = this.ensureBreedingRooms(plot);
      if (Array.isArray(plot.eggs) && Array.isArray(plot.ducks)) {
        rooms.forEach((rm, rIdx) => {
          const pMale = plot.ducks.find(d => d.id === rm.maleId);
          const pFemale = plot.ducks.find(d => d.id === rm.femaleId);
          if (!pMale || !pFemale) {
            rm.elapsedSec = 0;
            return;
          }
          if (plot.eggs.length >= plot.maxEggs) return;

          let total = (rm.elapsedSec || 0) + offlineSec;
          let laidAt = breedTimeSec - (rm.elapsedSec || 0);
          while (total >= breedTimeSec && plot.eggs.length < plot.maxEggs) {
            total -= breedTimeSec;
            const newEgg = this.generateOffspringEgg(
              pMale,
              pFemale,
              MUTATED_EGG_CHANCE,
              `💕 交配室#${rIdx + 1} (♂${pMale.name} × ♀${pFemale.name})`
            );
            const ageAfterLay = Math.max(0, offlineSec - laidAt);
            newEgg.remainingSec = Math.max(0, newEgg.remainingSec - ageAfterLay);
            plot.eggs.push(newEgg);
            laidEgg = true;
            laidAt += breedTimeSec;
          }
          rm.elapsedSec = plot.eggs.length >= plot.maxEggs ? 0 : total;
        });
      }
      plot.lastTickAt = lastTick + offlineSec * 1000;
    } else if (!plot.lastTickAt) {
      plot.lastTickAt = now;
    }

    return laidEgg;
  },

  getPlotBreedTimeSec(plot) {
    if (!plot || !plot.owner || !this.world || !this.world.accounts) return BREED_TIME_SEC;
    const acc = this.world.accounts[plot.owner];
    const lv = acc ? (acc.breedSpeedLv || 1) : 1;
    return Math.max(30, BREED_TIME_SEC - (lv - 1) * 3);
  },

  getEffectiveBreedElapsedSec(plot, rm) {
    const baseElapsed = (rm && rm.elapsedSec) || 0;
    if (!plot || !plot.owner || this.isPlayerOnline(plot.owner)) {
      return baseElapsed;
    }
    if (!rm || !rm.maleId || !rm.femaleId) return 0;
    if (plot.eggs && plot.eggs.length >= plot.maxEggs) return baseElapsed;
    const lastTick = plot.lastTickAt || plot.updatedAt || Date.now();
    const elapsed = Math.max(0, Math.floor((Date.now() - lastTick) / 1000));
    const breedTimeSec = this.getPlotBreedTimeSec(plot);
    return (baseElapsed + elapsed) % breedTimeSec;
  },

  getEffectiveEggRemainingSec(plot, egg) {
    const baseRem = egg.remainingSec !== undefined
      ? egg.remainingSec
      : (egg.isMutated ? HATCH_TIME_MUTATED_SEC : HATCH_TIME_NORMAL_SEC);
    if (!plot || !plot.owner || this.isPlayerOnline(plot.owner)) {
      return Math.max(0, baseRem);
    }
    const lastTick = plot.lastTickAt || plot.updatedAt || Date.now();
    const elapsed = Math.max(0, Math.floor((Date.now() - lastTick) / 1000));
    return Math.max(0, baseRem - elapsed);
  },

  allocatePlotForNewAccount() {
    for (let i = 0; i < 4; i++) {
      if (!this.world.plots[i] || !this.world.plots[i].owner) {
        return i;
      }
    }
    return 0;
  },

  checkOfflineMailbox(acc) {
    if (!acc.mailbox || acc.mailbox.length === 0) return;
    const plot = this.getMyPlot();
    acc.mailbox.forEach(item => {
      if (item.coins) acc.coins += item.coins;
      if (item.egg && plot && plot.eggs.length < plot.maxEggs) {
        plot.eggs.push(item.egg);
      }
      this.addLog(`📬 離線通知：${item.message}`);
    });
    acc.mailbox = [];
    this.notify('📬 你收到了夥伴在離線期間的相親紅利與混血蛋！', 'success');
  },

  // ==========================================================================
  // 領地與 3 隻出戰小隊戰力輔助
  // ==========================================================================
  getAllPlots() {
    return this.world ? this.world.plots : [];
  },

  getMyAccount() {
    return (this.world && this.currentUser) ? this.world.accounts[this.currentUser] : null;
  },

  getMyPlotIndex() {
    const acc = this.getMyAccount();
    return acc ? acc.plotIndex : 0;
  },

  getMyPlot() {
    const idx = this.getMyPlotIndex();
    return this.world ? this.world.plots[idx] : null;
  },

  isMyPlot(plotIndex) {
    return this.currentUser && plotIndex === this.getMyPlotIndex();
  },

  isPlayerOnline(username) {
    if (username === this.currentUser) return true;
    return Object.values(NetEngine.onlinePeers).some(p => p.username === username);
  },

  getPlotTotalPower(plot) {
    if (!plot || !plot.ducks) return 0;
    return plot.ducks.reduce((sum, d) => sum + evaluateDuckInfo(d).combatPower, 0);
  },

  // 每邊最多派 3 隻主力鴨子組成聯合隊伍！
  ensureValidSquad() {
    const acc = this.getMyAccount();
    const plot = this.getMyPlot();
    if (!acc || !plot) return;

    const validDuckIds = new Set((plot.ducks || []).map(d => d.id));
    acc.squadIds = (acc.squadIds || []).filter(id => validDuckIds.has(id)).slice(0, MAX_SQUAD_SIZE);

    if (acc.squadIds.length < MAX_SQUAD_SIZE && plot.ducks.length > 0) {
      const sorted = [...plot.ducks].sort((a, b) => evaluateDuckInfo(b).combatPower - evaluateDuckInfo(a).combatPower);
      for (const d of sorted) {
        if (acc.squadIds.length >= MAX_SQUAD_SIZE) break;
        if (!acc.squadIds.includes(d.id)) {
          acc.squadIds.push(d.id);
        }
      }
    }
  },

  getMySquadDucks() {
    const acc = this.getMyAccount();
    const plot = this.getMyPlot();
    if (!acc || !plot) return [];
    this.ensureValidSquad();
    return acc.squadIds.slice(0, MAX_SQUAD_SIZE).map(id => plot.ducks.find(d => d.id === id)).filter(Boolean);
  },

  getMySquadTotalPower() {
    return this.getMySquadDucks().reduce((sum, d) => sum + evaluateDuckInfo(d).combatPower, 0);
  },

  // ==========================================================================
  // 核心每秒循環：
  // 1. 3 組公母交配室 (60秒產卵一次，97%雙親遺傳 + 3%基因變異蛋)
  // 2. 鴨蛋孵化倒計時 (非變異蛋 1 分鐘 = 60秒、變異蛋 3 分鐘 = 180秒 自動破殼)
  // 3. 3+3 聯合戰鴨小隊自動攻擊 Boss ＆ 90秒限時倒數
  // ==========================================================================
  tick() {
    if (!this.currentUser) return;
    const myPlot = this.getMyPlot();
    const myAcc = this.getMyAccount();
    if (!myPlot || !myAcc) return;

    let worldChanged = false;
    myPlot.lastTickAt = Date.now();
    const rooms = this.ensureBreedingRooms(myPlot);
    const def = WorldCanvas.plotDefinitions[myPlot.plotIndex];

    const myBreedTimeSec = this.getPlotBreedTimeSec(myPlot);
    // 1. 【💕 3組公母生蛋交配室】自動交配產卵
    rooms.forEach((rm, rIdx) => {
      const maleDuck = myPlot.ducks.find(d => d.id === rm.maleId);
      const femaleDuck = myPlot.ducks.find(d => d.id === rm.femaleId);

      if (!maleDuck) rm.maleId = null;
      if (!femaleDuck) rm.femaleId = null;

      if (maleDuck && femaleDuck && myPlot.eggs.length < myPlot.maxEggs) {
        rm.elapsedSec = (rm.elapsedSec || 0) + 1;
        if (def && Math.random() < 0.28) {
          const slotPos = WorldCanvas.getBreedRoomSlotPos(rIdx, 'M');
          WorldCanvas.spawnFloatingText(def.x + slotPos.x + 85, def.y + slotPos.y - 18, '💕', '#f472b6', 15);
        }

        if (rm.elapsedSec >= myBreedTimeSec) {
          rm.elapsedSec = 0;
          this.layEggFromBreedingRoom(rIdx);
          worldChanged = true;
        }
      } else if (!maleDuck || !femaleDuck) {
        rm.elapsedSec = 0;
      }
    });

    // 2. 【🪺 孵化鴨窩區】鴨蛋倒計時 (非變異蛋 60秒 / 變異蛋 180秒)，歸零後停止並標示「待孵化」，需玩家手動點擊或一鍵孵化
    if (myPlot.eggs && myPlot.eggs.length > 0) {
      for (let ei = myPlot.eggs.length - 1; ei >= 0; ei--) {
        const egg = myPlot.eggs[ei];
        if (egg.remainingSec === undefined) {
          egg.totalSec = egg.isMutated ? HATCH_TIME_MUTATED_SEC : HATCH_TIME_NORMAL_SEC;
          egg.remainingSec = egg.totalSec;
        }

        if (egg.remainingSec > 0) {
          egg.remainingSec--;
        }
      }
    }

    // 若檢視面板正開著鴨蛋，即時刷新倒計時秒數顯示
    if (this.selectedEntity && this.selectedEntity.type === 'egg') {
      this.renderInspector();
    }

    // 3. 若正在進行【3+3 聯合小隊 Boss 共鬥】，由出戰鴨子自己攻擊 Boss 並依真實開始時間同步倒數！
    const raid = this.world.bossRaid;
    if (raid && raid.active) {
      if (raid.startedAt) {
        const dur = raid.durationSec || BOSS_RAID_DURATION_SEC;
        raid.remainingSec = Math.max(0, dur - Math.floor((Date.now() - raid.startedAt) / 1000));
      } else {
        if (raid.remainingSec === undefined) raid.remainingSec = BOSS_RAID_DURATION_SEC;
        raid.remainingSec = Math.max(0, raid.remainingSec - 1);
      }

      if (raid.remainingSec <= 0 && raid.bossHp > 0) {
        if (raid.hostUser === this.currentUser || !this.isPlayerOnline(raid.hostUser)) {
          this.failBossRaidTimeout(true);
          worldChanged = true;
        }
      }

      if (raid.active) {
        this.updateBossDamageMeterUI();
        if (raid.participants && raid.participants[this.currentUser]) {
          this.performSquadAutoAttackOnBoss();
        }
      }
    }

    // 4. 若夥伴目前離線，由在線玩家代為推進他的交配室產卵與蛋倒計時（只產卵＆倒數到 0，絕不代為孵化）並同步雲端
    const nowMs = Date.now();
    this.world.plots.forEach(p => {
      if (!p || !p.owner || p.owner === this.currentUser) return;
      if (this.isPlayerOnline(p.owner)) return;
      const lastP = p.lastTickAt || p.updatedAt || 0;
      if (nowMs - lastP >= 6000) {
        const laidNewEgg = this.applyOfflineEggCountdown(p);
        if (laidNewEgg) {
          p.updatedAt = nowMs;
          worldChanged = true;
        }
      }
    });

    if (worldChanged) {
      this.saveWorld(true);
    } else {
      this.saveWorld(false);
    }
  },

  createDuckObject(name, head, wing, body, gen = 1, forcedGender = null) {
    const pb = WorldCanvas.PASTURE_BOUNDS;
    return {
      id: 'duck_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      name: name || FUNNY_DUCK_NAMES[Math.floor(Math.random() * FUNNY_DUCK_NAMES.length)],
      gender: forcedGender || (Math.random() < 0.5 ? 'M' : 'F'),
      head,
      wing,
      body,
      gen,
      locked: false,
      lx: pb.minX + 60 + Math.random() * (pb.maxX - pb.minX - 120),
      ly: pb.minY + 60 + Math.random() * (pb.maxY - pb.minY - 120),
      tx: pb.minX + 60 + Math.random() * (pb.maxX - pb.minX - 120),
      ty: pb.minY + 60 + Math.random() * (pb.maxY - pb.minY - 120),
      facing: Math.random() < 0.5 ? 1 : -1,
      walkPhase: Math.random() * 6
    };
  },

  getDuckBreedRoomIndex(plot, duckId) {
    const rooms = this.ensureBreedingRooms(plot);
    for (let i = 0; i < rooms.length; i++) {
      if (rooms[i].maleId === duckId || rooms[i].femaleId === duckId) return i;
    }
    return -1;
  },

  clearDuckFromAllBreedRooms(plot, duckId) {
    const rooms = this.ensureBreedingRooms(plot);
    rooms.forEach(rm => {
      if (rm.maleId === duckId) { rm.maleId = null; rm.elapsedSec = 0; }
      if (rm.femaleId === duckId) { rm.femaleId = null; rm.elapsedSec = 0; }
    });
  },

  assignDuckToBreedZone(duckId, preferredRoomIdx = null) {
    const plot = this.getMyPlot();
    if (!plot) return;
    const duck = plot.ducks.find(d => d.id === duckId);
    if (!duck) return;

    const rooms = this.ensureBreedingRooms(plot);
    this.clearDuckFromAllBreedRooms(plot, duckId);

    const slotKey = duck.gender === 'M' ? 'maleId' : 'femaleId';
    const partnerKey = duck.gender === 'M' ? 'femaleId' : 'maleId';

    let targetIdx = (preferredRoomIdx !== null && preferredRoomIdx >= 0 && preferredRoomIdx < MAX_BREED_ROOMS)
      ? preferredRoomIdx
      : -1;

    if (targetIdx === -1) {
      // 優先找「已經有異性夥伴、且同性別槽空著」的房間
      targetIdx = rooms.findIndex(rm => !rm[slotKey] && rm[partnerKey]);
      if (targetIdx === -1) {
        targetIdx = rooms.findIndex(rm => !rm[slotKey]);
      }
      if (targetIdx === -1) {
        targetIdx = 0;
      }
    }

    rooms[targetIdx][slotKey] = duck.id;
    rooms[targetIdx].elapsedSec = 0;
    const gTxt = duck.gender === 'M' ? '♂ 公鴨' : '♀ 母鴨';
    this.notify(`${gTxt}【${duck.name}】已進入【交配室 #${targetIdx + 1}】！`, 'info');

    plot.updatedAt = Date.now();
    this.saveWorld(true);
    if (this.selectedEntity && this.selectedEntity.type === 'duck') {
      this.renderInspector();
    }
  },

  removeDuckFromBreedZone(duckId, targetRx, targetRy) {
    const plot = this.getMyPlot();
    if (!plot) return;
    const duck = plot.ducks.find(d => d.id === duckId);
    if (!duck) return;

    this.clearDuckFromAllBreedRooms(plot, duckId);

    const pb = WorldCanvas.PASTURE_BOUNDS;
    if (targetRx !== undefined && targetRy !== undefined) {
      duck.lx = Math.max(pb.minX, Math.min(pb.maxX, targetRx));
      duck.ly = Math.max(pb.minY, Math.min(pb.maxY, targetRy));
      duck.tx = duck.lx;
      duck.ty = duck.ly;
    }
    plot.updatedAt = Date.now();
    this.saveWorld(true);
    if (this.selectedEntity && this.selectedEntity.type === 'duck') {
      this.renderInspector();
    }
  },

  // 一鍵自動挑場上空閒的公母鴨填滿最多 3 組交配室（若玩家不小心把鴨子丟光則空投救援蛋）
  autoAssignBreedersOrRescue() {
    const plot = this.getMyPlot();
    if (!plot) return;

    if (plot.ducks.length < 2 && plot.eggs.length === 0) {
      plot.eggs.push({
        id: 'egg_rescue_' + Date.now(),
        rarity: 'common',
        isMutated: false,
        head: 'h_classic',
        wing: 'w_classic',
        body: 'b_classic',
        gen: 1,
        totalSec: HATCH_TIME_NORMAL_SEC,
        remainingSec: 30,
        parentInfo: '鴨神救援蛋',
        graffiti: [],
        blessedBy: [],
        stolenBy: []
      });
      this.notify('🛟 發現你的鴨場鴨子不足！鴨神免費空投了一顆救援蛋到鴨窩！', 'success');
      this.saveWorld(true);
      return;
    }

    const rooms = this.ensureBreedingRooms(plot);
    const prevSlots = rooms.map(rm => ({ maleId: rm.maleId, femaleId: rm.femaleId }));

    const allMales = [...plot.ducks]
      .filter(d => d.gender === 'M')
      .sort((a, b) => evaluateDuckInfo(b).combatPower - evaluateDuckInfo(a).combatPower);
    const allFemales = [...plot.ducks]
      .filter(d => d.gender === 'F')
      .sort((a, b) => evaluateDuckInfo(b).combatPower - evaluateDuckInfo(a).combatPower);

    const topMales = allMales.slice(0, MAX_BREED_ROOMS);
    const topFemales = allFemales.slice(0, MAX_BREED_ROOMS);
    const topMaleIds = new Set(topMales.map(d => d.id));
    const topFemaleIds = new Set(topFemales.map(d => d.id));

    // 先保留已經在交配室內的「前 3 高戰力鴨」，清掉戰力較低或已不存在的舊鴨
    const keptMaleIds = new Set();
    const keptFemaleIds = new Set();
    rooms.forEach(rm => {
      if (rm.maleId && topMaleIds.has(rm.maleId) && !keptMaleIds.has(rm.maleId)) {
        keptMaleIds.add(rm.maleId);
      } else {
        rm.maleId = null;
      }
      if (rm.femaleId && topFemaleIds.has(rm.femaleId) && !keptFemaleIds.has(rm.femaleId)) {
        keptFemaleIds.add(rm.femaleId);
      } else {
        rm.femaleId = null;
      }
    });

    const freeTopMales = topMales.filter(d => !keptMaleIds.has(d.id));
    const freeTopFemales = topFemales.filter(d => !keptFemaleIds.has(d.id));

    let changedCount = 0;
    for (let r = 0; r < MAX_BREED_ROOMS; r++) {
      const rm = rooms[r];
      if (!rm.maleId && freeTopMales.length > 0) {
        rm.maleId = freeTopMales.shift().id;
      }
      if (!rm.femaleId && freeTopFemales.length > 0) {
        rm.femaleId = freeTopFemales.shift().id;
      }
      if (rm.maleId !== prevSlots[r].maleId || rm.femaleId !== prevSlots[r].femaleId) {
        rm.elapsedSec = 0;
        changedCount++;
      }
    }

    const activePairs = rooms.filter(rm => rm.maleId && rm.femaleId).length;
    if (activePairs > 0) {
      plot.updatedAt = Date.now();
      if (changedCount > 0) {
        this.notify(`💕 已自動派出／替換戰力最強的公母鴨（目前 ${activePairs}/3 組運作中）！`, 'success');
      } else {
        this.notify(`💕 目前已經是場上最高戰力組合（${activePairs}/3 組運作中）！`, 'info');
      }
      this.saveWorld(true);
    } else {
      this.notify('⚠️ 需要場上同時有 ♂公鴨 與 ♀母鴨 才能配對交配喔！', 'warn');
    }
  },

  layEggFromBreedingRoom(roomIdx) {
    const plot = this.getMyPlot();
    if (!plot || plot.eggs.length >= plot.maxEggs) return;
    const rooms = this.ensureBreedingRooms(plot);
    const rm = rooms[roomIdx];
    if (!rm) return;

    const pMale = plot.ducks.find(d => d.id === rm.maleId);
    const pFemale = plot.ducks.find(d => d.id === rm.femaleId);
    if (!pMale || !pFemale) return;

    const newEgg = this.generateOffspringEgg(
      pMale,
      pFemale,
      MUTATED_EGG_CHANCE, // 3% 異變蛋機率，97% 雙親遺傳
      `💕 交配室#${roomIdx + 1} (♂${pMale.name} × ♀${pFemale.name})`
    );
    plot.eggs.push(newEgg);
    rm.elapsedSec = 0;
    plot.updatedAt = Date.now();

    const def = WorldCanvas.plotDefinitions[plot.plotIndex];
    if (def) {
      const slotPos = WorldCanvas.getBreedRoomSlotPos(roomIdx, 'M');
      WorldCanvas.spawnBurstParticles(def.x + slotPos.x + 85, def.y + slotPos.y, newEgg.isMutated ? '#c084fc' : '#fde047', 16);
      WorldCanvas.spawnFloatingText(
        def.x + slotPos.x + 85,
        def.y + slotPos.y - 26,
        newEgg.isMutated ? '🧬 3%奇蹟！【變異蛋】(3分鐘孵化)！' : '🥚 產下【遺傳蛋】(1分鐘孵化)！',
        newEgg.isMutated ? '#e9d5ff' : '#fde047',
        15
      );
    }
  },

  // 97% 雙親遺傳 ＋ 3% 基因變異演算法（精準控制整顆蛋的異變機率為 3%）
  generateOffspringEgg(duckA, duckB, mutatedChance = MUTATED_EGG_CHANCE, parentLabel = '雙親交配') {
    const acc = this.getMyAccount();
    const mutLv = acc ? (acc.mutationLv || 1) : 1;

    const hasMutation = Math.random() < mutatedChance;
    let head = Math.random() < 0.5 ? duckA.head : duckB.head;
    let wing = Math.random() < 0.5 ? duckA.wing : duckB.wing;
    let body = Math.random() < 0.5 ? duckA.body : duckB.body;

    if (hasMutation) {
      // 發生 3% 變異時，隨機挑選 1~2 個部位進行突變
      const parts = ['head', 'wing', 'body'];
      const mutIdx = Math.floor(Math.random() * parts.length);
      const pt = parts[mutIdx];
      if (pt === 'head') head = this.rollMutatedPart('head', mutLv);
      else if (pt === 'wing') wing = this.rollMutatedPart('wing', mutLv);
      else body = this.rollMutatedPart('body', mutLv);
    }

    const gen = Math.max(duckA.gen || 1, duckB.gen || 1) + 1;
    const info = evaluateDuckInfo({ head, wing, body, gen });
    const hatchSeconds = hasMutation ? HATCH_TIME_MUTATED_SEC : HATCH_TIME_NORMAL_SEC;

    return {
      id: 'egg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      rarity: info.rarityKey,
      isMutated: hasMutation,
      head,
      wing,
      body,
      gen,
      totalSec: hatchSeconds,
      remainingSec: hatchSeconds,
      parentInfo: parentLabel,
      graffiti: [],
      blessedBy: [],
      stolenBy: []
    };
  },

  // 嚴格控制出貨率的突變抽取函數（避免2分鐘就刷出紅鴨）
  rollMutatedPart(partType, mutLv = 1) {
    const weighted = [];
    DUCK_SETS.forEach(s => {
      const rObj = RARITIES[s.rarity];
      let w = rObj.probWeight || 10;

      // 初期 (突變研究所 Lv.1~2) 不會直接突變出紅色詛咒部位；需升級研究所或打高階 Boss
      if (s.rarity === 'cursed' && mutLv < 3) {
        w = 0;
      } else if (s.rarity === 'rare') {
        w += (mutLv - 1) * 18;
      } else if (s.rarity === 'epic') {
        w += (mutLv - 1) * 8;
      } else if (s.rarity === 'legendary') {
        w += Math.max(0, (mutLv - 2) * 3);
      } else if (s.rarity === 'cursed') {
        w += Math.max(0, (mutLv - 3) * 1);
      }

      for (let i = 0; i < w; i++) {
        weighted.push(s);
      }
    });

    const chosenSet = weighted[Math.floor(Math.random() * weighted.length)] || DUCK_SETS[0];
    return chosenSet[partType].id;
  },

  // 鴨蛋倒計時歸零後自動破殼孵化！
  autoHatchEggAtIndex(eggIdx) {
    const plot = this.getMyPlot();
    const acc = this.getMyAccount();
    if (!plot || !acc) return;

    const egg = plot.eggs[eggIdx];
    if (!egg) return;
    if (plot.ducks.length >= plot.maxDucks) return;

    const pos = WorldCanvas.getEggLocalPos(eggIdx);
    const def = WorldCanvas.plotDefinitions[plot.plotIndex];
    const worldX = def ? def.x + pos.x : 0;
    const worldY = def ? def.y + pos.y : 0;

    plot.eggs.splice(eggIdx, 1);

    // 智慧公母平衡保底
    const hasM = plot.ducks.some(d => d.gender === 'M');
    const hasF = plot.ducks.some(d => d.gender === 'F');
    let gender = Math.random() < 0.5 ? 'M' : 'F';
    if (!hasM) gender = 'M';
    else if (!hasF) gender = 'F';

    const newDuck = this.createDuckObject(null, egg.head, egg.wing, egg.body, egg.gen || 1, gender);
    plot.ducks.push(newDuck);
    plot.updatedAt = Date.now();

    const discovery = this.unlockCompendiumForDuck(newDuck);
    const info = evaluateDuckInfo(newDuck);
    this.ensureValidSquad();

    const gSymbol = newDuck.gender === 'M' ? '♂' : '♀';
    WorldCanvas.spawnBurstParticles(worldX, worldY, info.rarity.color, 26);
    WorldCanvas.spawnFloatingText(
      worldX,
      worldY - 30,
      `🐣 破殼孵化！【${info.rarity.name}】${gSymbol}${newDuck.name} (⚔️${info.combatPower})`,
      info.rarity.color,
      18
    );

    if (discovery.newSet) {
      const msg = `👑 驚天奇蹟！【${this.currentUser}】孵出了完整套裝覺醒鴨《${info.matchedSet.setName}》(⚔️戰力 ${info.combatPower})！`;
      this.addLog(msg, true);
    } else if (discovery.newParts.length > 0) {
      this.addLog(`✨ 圖鑑新發現！解鎖了新部位：${discovery.newParts.join('、')}！`);
    }

    if (this.selectedEntity && this.selectedEntity.type === 'egg' && this.selectedEntity.egg.id === egg.id) {
      this.onSelectEntity({ type: 'duck', duck: newDuck, plotIndex: plot.plotIndex });
    }
    return true;
  },

  hatchEggById(eggId) {
    const plot = this.getMyPlot();
    if (!plot || !Array.isArray(plot.eggs)) return false;
    const ei = plot.eggs.findIndex(e => e.id === eggId);
    if (ei === -1) return false;
    const egg = plot.eggs[ei];
    if ((egg.remainingSec || 0) > 0) {
      this.notify(`⏱️ 這顆蛋還需要等待 ${formatDurationMMSS(egg.remainingSec)} 才能孵化喔！`, 'info');
      return false;
    }
    if (plot.ducks.length >= plot.maxDucks) {
      this.notify(`⚠️ 鴨場已滿 (${plot.ducks.length}/${plot.maxDucks})，請先丟棄淘汰鴨或擴充容量！`, 'warn');
      return false;
    }
    if (this.autoHatchEggAtIndex(ei)) {
      this.saveWorld(true);
      return true;
    }
    return false;
  },

  hatchAllReadyEggs() {
    const plot = this.getMyPlot();
    if (!plot || !Array.isArray(plot.eggs) || plot.eggs.length === 0) {
      this.notify('🥚 鴨窩裡目前沒有蛋喔！', 'info');
      return;
    }
    const readyCount = plot.eggs.filter(e => (e.remainingSec || 0) <= 0).length;
    if (readyCount === 0) {
      this.notify('⏱️ 目前還沒有「待孵化」的鴨蛋喔！', 'info');
      return;
    }
    if (plot.ducks.length >= plot.maxDucks) {
      this.notify(`⚠️ 鴨場已滿 (${plot.ducks.length}/${plot.maxDucks})，請先丟棄淘汰鴨或擴充容量！`, 'warn');
      return;
    }

    let hatchedCount = 0;
    for (let ei = plot.eggs.length - 1; ei >= 0; ei--) {
      if (plot.ducks.length >= plot.maxDucks) break;
      if ((plot.eggs[ei].remainingSec || 0) <= 0) {
        if (this.autoHatchEggAtIndex(ei)) {
          hatchedCount++;
        }
      }
    }

    if (hatchedCount > 0) {
      this.saveWorld(true);
      const leftReady = plot.eggs.filter(e => (e.remainingSec || 0) <= 0).length;
      if (leftReady > 0) {
        this.notify(`🐣 已孵化 ${hatchedCount} 隻怪鴨！（鴨場已滿，還有 ${leftReady} 顆待孵化）`, 'warn');
      } else {
        this.notify(`🐣 一鍵孵蛋完成！共孵出 ${hatchedCount} 隻怪鴨！`, 'success');
      }
    }
  },

  unlockCompendiumForDuck(duck) {
    const acc = this.getMyAccount();
    if (!acc) return { newParts: [], newSet: false };
    if (!acc.unlockedParts) acc.unlockedParts = {};
    if (!acc.unlockedSets) acc.unlockedSets = {};

    const newParts = [];
    ['head', 'wing', 'body'].forEach(pt => {
      const pid = duck[pt];
      if (!acc.unlockedParts[pid] && PARTS_DB[pt][pid]) {
        acc.unlockedParts[pid] = true;
        newParts.push(PARTS_DB[pt][pid].name);
      }
    });

    const info = evaluateDuckInfo(duck);
    let newSet = false;
    if (info.isFullSet && info.matchedSet && !acc.unlockedSets[info.matchedSet.setId]) {
      acc.unlockedSets[info.matchedSet.setId] = true;
      newSet = true;
    }
    acc.updatedAt = Date.now();
    return { newParts, newSet };
  },

  // ==========================================================================
  // ⚔️ 3+3 聯合怪鴨戰隊編成 ＆ 組隊討伐 Boss 系統 (純鴨子自動攻擊 + 即時傷害榜)
  // ==========================================================================
  openSquadAndBossModal() {
    this.ensureValidSquad();
    this.renderSquadAndBossModal();
    document.getElementById('squadBossModal').classList.remove('hidden');
  },

  autoFillBestSquad() {
    const acc = this.getMyAccount();
    const plot = this.getMyPlot();
    if (!acc || !plot) return;

    const sorted = [...plot.ducks].sort((a, b) => evaluateDuckInfo(b).combatPower - evaluateDuckInfo(a).combatPower);
    acc.squadIds = sorted.slice(0, MAX_SQUAD_SIZE).map(d => d.id);
    acc.updatedAt = Date.now();
    this.notify(`⚔️ 已自動選取戰力最高的 ${MAX_SQUAD_SIZE} 隻主力怪鴨編入出戰小隊！`, 'success');
    this.saveWorld(true);
    this.renderSquadAndBossModal();
  },

  toggleDuckInSquad(duckId) {
    const acc = this.getMyAccount();
    if (!acc) return;
    if (!acc.squadIds) acc.squadIds = [];

    const idx = acc.squadIds.indexOf(duckId);
    if (idx !== -1) {
      acc.squadIds.splice(idx, 1);
    } else {
      if (acc.squadIds.length >= MAX_SQUAD_SIZE) {
        this.notify(`⚠️ 每位玩家最多派遣 ${MAX_SQUAD_SIZE} 隻怪鴨組成聯合隊伍！請先取消勾選一隻再更換。`, 'warn');
        return;
      }
      acc.squadIds.push(duckId);
    }
    acc.updatedAt = Date.now();
    this.saveWorld(true);
    this.renderSquadAndBossModal();
    if (this.selectedEntity && this.selectedEntity.type === 'duck') {
      this.renderInspector();
    }
  },

  selectBossTier(tierId) {
    this.selectedBossTierId = tierId;
    this.renderSquadAndBossModal();
  },

  renderSquadAndBossModal() {
    const acc = this.getMyAccount();
    const plot = this.getMyPlot();
    if (!acc || !plot) return;

    const squadDucks = this.getMySquadDucks();
    const squadPower = this.getMySquadTotalPower();

    document.getElementById('mySquadPowerBadge').textContent =
      `⚔️ 我的 3 隻出戰小隊戰力：${squadPower.toLocaleString()} (已選 ${squadDucks.length}/${MAX_SQUAD_SIZE} 隻｜雙人聯合共 6 隻戰鴨圍攻)`;

    const sortedDucks = [...plot.ducks].sort((a, b) => evaluateDuckInfo(b).combatPower - evaluateDuckInfo(a).combatPower);
    const listEl = document.getElementById('squadDuckPickerList');
    listEl.innerHTML = sortedDucks.map(d => {
      const info = evaluateDuckInfo(d);
      const inSquad = (acc.squadIds || []).includes(d.id);
      const gSym = d.gender === 'M' ? '♂' : '♀';
      return `
        <div class="duck-pick-item ${inSquad ? 'selected' : ''}" onclick="Game.toggleDuckInSquad('${d.id}')">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="dp-title" style="color:${info.rarity.color}">
              ${inSquad ? '✅ [出戰中]' : '⬜'} [${info.rarity.name}] ${gSym}${d.name}
            </span>
            <span style="font-weight:900;color:#fde047;">⚔️ 戰力 ${info.combatPower}</span>
          </div>
          <div class="dp-parts">
            絕招：${info.skillName} ｜ 頭:${info.headPart.name} / 翅:${info.wingPart.name} / 身:${info.bodyPart.name}
          </div>
        </div>
      `;
    }).join('') || '<div class="empty-hint">你的鴨場目前沒有鴨子</div>';

    const sac = this.ensurePitSacrifices();
    const bossEl = document.getElementById('bossTierPickerList');
    bossEl.innerHTML = `
      <div style="background:rgba(88,28,135,0.45);border:1px solid #c084fc;border-radius:8px;padding:7px 10px;margin-bottom:8px;font-size:11.5px;color:#f3e8ff;">
        🕳️ <b>黑洞祭品儲備 (每階皆需獻祭滿 30 隻)：</b>
        🦆普:<b style="color:#fde047">${sac.total || 0}/30</b> ｜
        💠藍+:<b style="color:#38bdf8">${sac.rarePlus || 0}/30</b> ｜
        🔮紫+:<b style="color:#c084fc">${sac.epicPlus || 0}/30</b> ｜
        👑金/套:<b style="color:#fbbf24">${sac.legendaryOrSet || 0}/30</b> ｜
        🩸紅/高套:<b style="color:#f43f5e">${sac.cursedOrHighSet || 0}/30</b>
      </div>
    ` + BOSS_TIERS.map(b => {
      const sel = b.id === this.selectedBossTierId ? 'selected' : '';
      const curCnt = sac[b.reqType] || 0;
      const isReady = curCnt >= b.reqCount;
      const armorPct = Math.round((b.armorReduction || 0) * 100);
      const reqBadge = isReady
        ? `<span style="color:#4ade80;font-weight:900;">✅ 祭品已達標 (${curCnt}/${b.reqCount}) — 可立即召喚</span>`
        : `<span style="color:#fca5a5;font-weight:800;">🔒 祭品不足 (${curCnt}/${b.reqCount}) — 需${b.reqLabel}</span>`;
      return `
        <div class="duck-pick-item ${sel}" onclick="Game.selectBossTier('${b.id}')">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="dp-title" style="color:${b.color}">${b.name}</span>
            <span style="font-size:11.5px;color:#38bdf8;">HP:${b.maxHp.toLocaleString()} ｜ 減傷:${armorPct}% ｜ 推薦:${b.recPower.toLocaleString()}+</span>
          </div>
          <div style="font-size:11px;margin-top:3px;">${reqBadge}</div>
          <div class="dp-parts">${b.desc}</div>
        </div>
      `;
    }).join('');
  },

  // 發起連線組隊討伐 Boss（採用【30隻祭品召喚制】：需累積滿 30 隻對應階級祭品並由玩家手動發起）
  launchCoopBossRaid(sendInvite = true) {
    const squad = this.getMySquadDucks();
    if (squad.length === 0) {
      this.notify('⚠️ 請至少編入 1 隻怪鴨到出戰小隊！', 'warn');
      return;
    }

    const tier = BOSS_TIERS.find(b => b.id === this.selectedBossTierId) || BOSS_TIERS[0];
    const sac = this.ensurePitSacrifices();
    const curCnt = sac[tier.reqType] || 0;
    if (curCnt < tier.reqCount) {
      this.notify(`🔒 祭品不足！召喚【${tier.name}】需要「${tier.reqLabel}」（目前累積：${curCnt}/${tier.reqCount}）。請先將對應品質的鴨子拖進中央大黑洞獻祭！`, 'warn');
      return;
    }

    // 扣除召喚該階級 Boss 所需的 30 隻祭品
    sac[tier.reqType] = Math.max(0, curCnt - tier.reqCount);
    this.world.pit.updatedAt = Date.now();
    const myPower = this.getMySquadTotalPower();

    this.world.bossRaid = {
      active: true,
      raidId: 'raid_' + Date.now(),
      bossTierId: tier.id,
      bossName: tier.name,
      bossHp: tier.maxHp,
      bossMaxHp: tier.maxHp,
      startedAt: Date.now(),
      durationSec: BOSS_RAID_DURATION_SEC,
      remainingSec: BOSS_RAID_DURATION_SEC,
      hostUser: this.currentUser,
      updatedAt: Date.now(),
      participants: {
        [this.currentUser]: {
          username: this.currentUser,
          squadPower: myPower,
          damage: 0,
          squad: JSON.parse(JSON.stringify(squad))
        }
      }
    };

    document.getElementById('squadBossModal').classList.add('hidden');
    WorldCanvas.focusOnPit();

    if (sendInvite) {
      NetEngine.send('BOSS_RAID_INVITE', {
        raidId: this.world.bossRaid.raidId,
        hostUser: this.currentUser,
        bossTierId: tier.id,
        bossName: tier.name,
        bossMaxHp: tier.maxHp
      });
      this.addLog(`🚨 【聯合討伐召集】【${this.currentUser}】派出了 ${squad.length} 隻主力戰鴨 (⚔️戰力 ${myPower}) 討伐【${tier.name}】！已邀請連線夥伴派遣 3 隻戰鴨合流！`, true);
      this.notify(`⚔️ 已開啟【${tier.name}】討伐戰並向連線夥伴發送組隊邀請！`, 'success');
    } else {
      NetEngine.send('BOSS_RAID_START', { bossRaid: this.world.bossRaid });
    }

    this.saveWorld(true);
    this.updateBossDamageMeterUI();
  },

  onReceiveBossRaidInvite(payload) {
    if (!payload || payload.hostUser === this.currentUser) return;
    this.pendingInteraction = { mode: 'boss_invite', ...payload };
    const box = document.getElementById('incomingRequestBanner');
    const txt = document.getElementById('incomingRequestText');
    const myPower = this.getMySquadTotalPower();
    txt.innerHTML = `🚨 <b>【3+3 聯合隊伍召集】</b> 玩家【<b>${payload.hostUser}</b>】邀請你組建聯合隊伍討伐 <b>${payload.bossName}</b>！是否派遣你的 3 隻主力戰鴨 (⚔️戰力 ${myPower}) 一同出擊？`;
    box.classList.remove('hidden');
  },

  joinActiveBossRaid() {
    const raid = this.world.bossRaid;
    if (!raid || !raid.active) {
      this.notify('目前沒有進行中的 Boss 討伐戰！', 'warn');
      return;
    }

    const squad = this.getMySquadDucks();
    const myPower = this.getMySquadTotalPower();
    const participantData = {
      username: this.currentUser,
      squadPower: myPower,
      damage: (raid.participants[this.currentUser] && raid.participants[this.currentUser].damage) || 0,
      squad: JSON.parse(JSON.stringify(squad))
    };

    raid.participants[this.currentUser] = participantData;
    raid.updatedAt = Date.now();

    NetEngine.send('BOSS_RAID_ACCEPT', {
      username: this.currentUser,
      participant: participantData
    });

    WorldCanvas.focusOnPit();
    this.addLog(`⚔️ 【${this.currentUser}】派出了 ${squad.length} 隻主力戰鴨 (⚔️戰力 ${myPower}) 加入聯合隊伍一同圍攻 Boss！`, true);
    this.notify('⚔️ 你的 3 隻戰鴨已加入聯合隊伍自動攻擊 Boss！', 'success');
    this.saveWorld(true);
  },

  onRemotePlayerJoinedRaid(payload) {
    const raid = this.world.bossRaid;
    if (!raid || !raid.active || !payload) return;
    raid.participants[payload.username] = payload.participant;
    raid.updatedAt = Date.now();
    this.notify(`🎉 夥伴【${payload.username}】的 3 隻戰鴨已加入聯合隊伍一同攻擊！`, 'success');
    this.updateBossDamageMeterUI();
  },

  onRemoteBossRaidStarted(payload) {
    if (payload && payload.bossRaid) {
      this.world.bossRaid = payload.bossRaid;
      this.updateBossDamageMeterUI();
    }
  },

  // 每秒由我方派出的 3 隻戰鴨自己發動攻擊（無滑鼠連點傷害）
  performSquadAutoAttackOnBoss() {
    const raid = this.world.bossRaid;
    if (!raid || !raid.active) return;
    const me = raid.participants[this.currentUser];
    if (!me) return;

    const squad = me.squad || [];
    if (squad.length === 0) return;

    const tier = BOSS_TIERS.find(b => b.id === raid.bossTierId) || BOSS_TIERS[0];
    const armorMult = Math.max(0.15, 1 - (tier.armorReduction || 0));
    const totalPower = Math.max(60, me.squadPower || this.getMySquadTotalPower());
    const dmg = Math.max(10, Math.round(totalPower * armorMult * (0.92 + Math.random() * 0.20)));

    // 計算聯合隊伍總鴨數以對齊場上站位發射飛彈
    const members = Object.values(raid.participants || {});
    let allDucks = [];
    members.forEach(m => {
      (m.squad || []).forEach(sd => allDucks.push({ ...sd, ownerName: m.username }));
    });

    allDucks.forEach((sd, idx) => {
      if (sd.ownerName === this.currentUser) {
        const ang = (idx / Math.max(1, allDucks.length)) * Math.PI * 2;
        const sx = Math.cos(ang) * (WorldCanvas.PIT_RADIUS + 38);
        const sy = Math.sin(ang) * (WorldCanvas.PIT_RADIUS + 38);
        const info = evaluateDuckInfo(sd);
        WorldCanvas.spawnProjectile(sx, sy, 0, 0, info.projColor);
      }
    });

    this.applyBossDamage(this.currentUser, dmg);
    NetEngine.send('BOSS_RAID_DAMAGE', {
      username: this.currentUser,
      dmg
    });
  },

  // 點擊中央深淵：不造成點擊傷害！若尚未開戰則開啟組隊編隊視窗；若尚未參戰則加入聯合隊伍
  onClickCentralPit() {
    const raid = this.world.bossRaid;
    if (!raid || !raid.active) {
      this.openSquadAndBossModal();
      return;
    }

    if (!raid.participants[this.currentUser]) {
      this.joinActiveBossRaid();
    } else {
      this.notify('⚔️ 聯合隊伍的怪鴨們正在自動圍攻 Boss！請於左上角查看即時傷害統計榜。', 'info');
    }
  },

  applyBossDamage(username, dmg) {
    const raid = this.world.bossRaid;
    if (!raid || !raid.active) return;

    if (!raid.participants[username]) {
      raid.participants[username] = {
        username,
        squadPower: dmg,
        damage: 0,
        squad: []
      };
    }

    raid.participants[username].damage = (raid.participants[username].damage || 0) + dmg;
    raid.bossHp = Math.max(0, raid.bossHp - dmg);
    raid.updatedAt = Date.now();

    const isMe = username === this.currentUser;
    WorldCanvas.spawnFloatingText(
      (Math.random() - 0.5) * 130,
      -30 + (Math.random() - 0.5) * 70,
      `${isMe ? '🦆' : '🤝'} ${username}小隊: -${dmg.toLocaleString()}`,
      isMe ? '#fde047' : '#38bdf8',
      17
    );

    this.updateBossDamageMeterUI();

    if (raid.bossHp <= 0) {
      this.completeBossRaidVictory(true);
    }
  },

  onRemoteBossRaidDamage(payload) {
    if (!payload) return;
    this.applyBossDamage(payload.username, payload.dmg);
  },

  completeBossRaidVictory(broadcastVictory = false) {
    const raid = this.world.bossRaid;
    if (!raid || !raid.active) return;
    raid.active = false;
    raid.bossHp = 0;
    raid.updatedAt = Date.now();

    const tier = BOSS_TIERS.find(b => b.id === raid.bossTierId) || BOSS_TIERS[0];
    WorldCanvas.spawnBurstParticles(0, 0, '#f43f5e', 55);
    WorldCanvas.spawnFloatingText(0, -65, `🏆 聯合討伐成功！擊潰【${tier.name}】！`, '#fde047', 24);

    if (broadcastVictory) {
      NetEngine.send('BOSS_RAID_VICTORY', {
        bossTierId: tier.id,
        participants: raid.participants
      });
    }

    this.grantBossRaidRewards(tier, raid.participants);
    this.updateBossDamageMeterUI();
    this.saveWorld(true);
  },

  onRemoteBossRaidVictory(payload) {
    const raid = this.world.bossRaid;
    if (raid && raid.active) {
      raid.active = false;
      raid.bossHp = 0;
      if (payload && payload.participants) {
        raid.participants = payload.participants;
      }
      const tier = BOSS_TIERS.find(b => b.id === (payload.bossTierId || raid.bossTierId)) || BOSS_TIERS[0];
      this.grantBossRaidRewards(tier, raid.participants);
      this.updateBossDamageMeterUI();
    }
  },

  failBossRaidTimeout(broadcastTimeout = false) {
    const raid = this.world.bossRaid;
    if (!raid || !raid.active) return;
    raid.active = false;
    raid.remainingSec = 0;
    raid.updatedAt = Date.now();

    const tier = BOSS_TIERS.find(b => b.id === raid.bossTierId) || BOSS_TIERS[0];
    WorldCanvas.spawnFloatingText(0, -65, `💀 討伐逾時！【${tier.name}】遁入深淵！`, '#f87171', 22);
    this.addLog(`💀 【Boss 討伐失敗】未能在 90 秒內擊敗【${tier.name}】，Boss 已遁回黑洞深處！請提升戰鴨品質後再戰！`);
    this.notify(`💀 討伐【${tier.name}】逾時失敗！請強化小隊戰力後再挑戰！`, 'warn');

    if (broadcastTimeout) {
      NetEngine.send('BOSS_RAID_TIMEOUT', { bossTierId: tier.id });
    }
    this.updateBossDamageMeterUI();
    this.saveWorld(true);
  },

  onRemoteBossRaidTimeout() {
    const raid = this.world.bossRaid;
    if (raid && raid.active) {
      raid.active = false;
      raid.remainingSec = 0;
      this.notify('💀 Boss 討伐時間到，Boss 已遁回深淵！', 'warn');
      this.updateBossDamageMeterUI();
    }
  },

  // 依據 Boss 階級的 dropTable 權重抽取戰利品變異蛋 (3分鐘孵化倒計時)
  rollSetFromDropTable(dropTable) {
    const r = Math.random();
    let acc = 0;
    let chosenRarity = 'rare';
    for (const rKey of RARITY_ORDER) {
      acc += (dropTable[rKey] || 0);
      if (r <= acc) {
        chosenRarity = rKey;
        break;
      }
    }
    const pool = DUCK_SETS.filter(s => s.rarity === chosenRarity);
    return pool[Math.floor(Math.random() * pool.length)] || DUCK_SETS[0];
  },

  grantBossRaidRewards(tier, participants) {
    const plot = this.getMyPlot();
    const acc = this.getMyAccount();
    if (!plot || !acc) return;

    const list = Object.values(participants || {}).sort((a, b) => (b.damage || 0) - (a.damage || 0));
    const totalDmg = Math.max(1, list.reduce((s, p) => s + (p.damage || 0), 0));

    acc.coins = (acc.coins || 0) + tier.coinReward;

    const sH = this.rollSetFromDropTable(tier.dropTable);
    const sW = this.rollSetFromDropTable(tier.dropTable);
    const sB = this.rollSetFromDropTable(tier.dropTable);
    const info = evaluateDuckInfo({ head: sH.head.id, wing: sW.wing.id, body: sB.body.id });

    plot.eggs.push({
      id: 'egg_boss_' + Date.now(),
      rarity: info.rarityKey,
      isMutated: true, // Boss 戰利品蛋屬於變異蛋，倒計時 3 分鐘自動孵化
      head: sH.head.id,
      wing: sW.wing.id,
      body: sB.body.id,
      gen: 5,
      totalSec: HATCH_TIME_MUTATED_SEC,
      remainingSec: HATCH_TIME_MUTATED_SEC,
      parentInfo: `🏆 討伐【${tier.name}】戰利品變異蛋`,
      graffiti: [],
      blessedBy: [],
      stolenBy: []
    });

    const rankStr = list.map((p, idx) => {
      const pct = Math.round(((p.damage || 0) / totalDmg) * 100);
      return `${idx === 0 ? '👑MVP' : `#${idx + 1}`} ${p.username}: ${p.damage.toLocaleString()} 傷害 (${pct}%)`;
    }).join(' ｜ ');

    this.addLog(`🏆 【Boss 討伐結算】成功擊敗 ${tier.name}！聯合隊伍傷害統計：${rankStr}！獲得 +${tier.coinReward} 鴨幣與 1 顆【${info.rarity.name}變異蛋(3分孵化)】！`);
    this.notify(`🏆 擊敗 ${tier.name}！獲得 +${tier.coinReward} 鴨幣與【${info.rarity.name}變異蛋】！`, 'success');
  },

  updateBossDamageMeterUI() {
    const box = document.getElementById('liveBossDamagePanel');
    if (!box || !this.world) return;

    const raid = this.world.bossRaid;
    if (!raid || !raid.active) {
      box.classList.add('hidden');
      return;
    }

    box.classList.remove('hidden');
    const tier = BOSS_TIERS.find(b => b.id === raid.bossTierId) || BOSS_TIERS[0];
    const hpPct = Math.max(0, Math.min(100, Math.round((raid.bossHp / raid.bossMaxHp) * 100)));

    const list = Object.values(raid.participants || {}).sort((a, b) => (b.damage || 0) - (a.damage || 0));
    const totalDmg = Math.max(1, list.reduce((s, p) => s + (p.damage || 0), 0));
    const amIParticipating = !!(raid.participants && raid.participants[this.currentUser]);

    const rowsHtml = list.map((p, idx) => {
      const dmg = p.damage || 0;
      const sharePct = Math.round((dmg / totalDmg) * 100);
      const isMe = p.username === this.currentUser;
      const duckCnt = (p.squad || []).length;
      return `
        <div class="dmg-meter-row ${isMe ? 'mine' : ''}">
          <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:800;">
            <span>${idx === 0 ? '👑' : '🦆'} ${p.username} (${duckCnt}隻｜⚔️${(p.squadPower || 0).toLocaleString()})</span>
            <span style="color:#fde047">${dmg.toLocaleString()} (${sharePct}%)</span>
          </div>
          <div class="dmg-bar-bg">
            <div class="dmg-bar-fill" style="width:${sharePct}%;background:${isMe ? '#facc15' : '#38bdf8'}"></div>
          </div>
        </div>
      `;
    }).join('');

    const remSec = raid.remainingSec !== undefined ? raid.remainingSec : BOSS_RAID_DURATION_SEC;
    const armorPct = Math.round((tier.armorReduction || 0) * 100);
    box.innerHTML = `
      <div class="dmg-header">
        <span style="color:#fda4af;font-weight:900;">📊 3+3 聯合戰隊即時傷害統計</span>
        <span style="font-size:11px;color:#fde047;">⏱️${remSec}s ｜ HP ${hpPct}%</span>
      </div>
      <div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:4px;">${tier.name} (🛡️減傷 ${armorPct}%)</div>
      <div class="boss-hp-mini-bg">
        <div class="boss-hp-mini-fill" style="width:${hpPct}%;background:${tier.color}"></div>
      </div>
      <div style="font-size:11px;color:#cbd5e1;margin-bottom:8px;">
        剩餘血量：${Math.ceil(raid.bossHp).toLocaleString()} / ${raid.bossMaxHp.toLocaleString()}
      </div>
      <div class="dmg-rows-wrap">${rowsHtml}</div>
      ${!amIParticipating ? `
        <button class="btn-sm btn-gold full-w" style="margin-top:8px;" onclick="Game.joinActiveBossRaid()">
          ⚔️ 派遣我的 3 隻戰鴨加入聯合隊伍！
        </button>
      ` : `
        <div style="font-size:11px;color:#4ade80;text-align:center;margin-top:6px;">
          🦆 你的 3 隻主力戰鴨正自動圍攻 Boss 中！
        </div>
      `}
    `;
  },

  // ==========================================================================
  // 黑洞階梯祭品獻祭系統（丟鴨子只累積階梯祭品與拿鴨幣，絕不自動強制開打 Boss！）
  // ==========================================================================
  sacrificeDuckToPit(duckId) {
    const plot = this.getMyPlot();
    const acc = this.getMyAccount();
    if (!plot || !acc) return;

    const idx = plot.ducks.findIndex(d => d.id === duckId);
    if (idx === -1) return;
    const duck = plot.ducks[idx];

    if (duck.locked) {
      this.notify('🔒 這隻鴨子已被鎖定保護，不會被丟進黑洞！', 'warn');
      return;
    }

    if (plot.breederMaleId === duckId) plot.breederMaleId = null;
    if (plot.breederFemaleId === duckId) plot.breederFemaleId = null;
    this.clearDuckFromAllBreedRooms(plot, duckId);
    plot.ducks.splice(idx, 1);
    plot.updatedAt = Date.now();
    this.ensureValidSquad();

    const info = evaluateDuckInfo(duck);
    const coinReward = info.rarity.sacrificeValue + (info.isFullSet ? 30 : 0);

    acc.coins = (acc.coins || 0) + coinReward;
    acc.updatedAt = Date.now();

    const def = WorldCanvas.plotDefinitions[plot.plotIndex];
    const startWx = def ? def.x + (duck.lx || 0) : 0;
    const startWy = def ? def.y + (duck.ly || 0) : 0;
    WorldCanvas.spawnFlyingSacrificeDuck(duck, startWx, startWy);

    const addedTags = this.recordDuckSacrifice(duck);
    const sacNow = this.ensurePitSacrifices();

    this.notify(`🕳️ 獻祭成功！+${coinReward} 鴨幣（祭壇進度：普 ${sacNow.total}/30）`, 'success');
    this.addLog(`🕳️ 你把【${info.rarity.name}${info.isFullSet ? '套裝' : ''}｜${duck.name}】獻祭進中央黑洞！獲得 +${coinReward} 鴨幣，累積祭品：${addedTags}！`);
    NetEngine.send('PIT_SACRIFICE', { duck, pit: this.world.pit });

    if (this.selectedEntity && this.selectedEntity.type === 'duck' && this.selectedEntity.duck.id === duckId) {
      this.closeInspector();
    }
    this.saveWorld(true);
  },

  recordDuckSacrifice(duck) {
    const sac = this.ensurePitSacrifices();
    this.world.pit.updatedAt = Date.now();
    const info = evaluateDuckInfo(duck);
    const tags = ['🦆普鴨+1'];

    sac.total = (sac.total || 0) + 1;

    if (['rare', 'epic', 'legendary', 'cursed'].includes(info.rarityKey)) {
      sac.rarePlus = (sac.rarePlus || 0) + 1;
      tags.push('💠藍鴨以上+1');
    }
    if (['epic', 'legendary', 'cursed'].includes(info.rarityKey)) {
      sac.epicPlus = (sac.epicPlus || 0) + 1;
      tags.push('🔮紫鴨以上+1');
    }
    if (['legendary', 'cursed'].includes(info.rarityKey) || (info.isFullSet && ['rare', 'epic', 'legendary', 'cursed'].includes(info.rarityKey))) {
      sac.legendaryOrSet = (sac.legendaryOrSet || 0) + 1;
      tags.push('👑金/稀套+1');
    }
    if (info.rarityKey === 'cursed' || (info.isFullSet && ['epic', 'legendary', 'cursed'].includes(info.rarityKey))) {
      sac.cursedOrHighSet = (sac.cursedOrHighSet || 0) + 1;
      tags.push('🩸紅/高階套裝+1');
    }

    return tags.join('、');
  },

  onRemotePitSacrifice(senderName, duck, remotePit) {
    if (!duck) return;
    WorldCanvas.spawnFlyingSacrificeDuck(duck, (Math.random() - 0.5) * 600, (Math.random() - 0.5) * 600);
    if (remotePit && (remotePit.updatedAt || 0) > ((this.world.pit && this.world.pit.updatedAt) || 0)) {
      this.world.pit = remotePit;
      this.ensurePitSacrifices();
    } else {
      this.recordDuckSacrifice(duck);
    }
    this.addLog(`🕳️ 夥伴【${senderName}】將「${duck.name}」獻祭進中央黑洞！`);
    this.updateHUD();
  },

  // ==========================================================================
  // 多人互動：偷摸基因分身蛋＋塗鴉惡作劇、幫孵加速(-20秒)、跨場相親、點對點交換
  // ==========================================================================
  blessNeighborEgg(plotIndex, eggId) {
    const targetPlot = this.world.plots[plotIndex];
    const myAcc = this.getMyAccount();
    if (!targetPlot || !myAcc) return;

    const egg = (targetPlot.eggs || []).find(e => e.id === eggId);
    if (!egg) return;

    if (!egg.blessedBy) egg.blessedBy = [];
    if (egg.blessedBy.includes(this.currentUser)) {
      this.notify('🔥 這顆蛋你已經幫忙加熱加速過囉！', 'warn');
      return;
    }

    egg.blessedBy.push(this.currentUser);
    egg.remainingSec = Math.max(0, (egg.remainingSec || 60) - 20);
    myAcc.coins = (myAcc.coins || 0) + 10;
    targetPlot.updatedAt = Date.now();

    const def = WorldCanvas.plotDefinitions[plotIndex];
    if (def) {
      WorldCanvas.spawnBurstParticles(def.x + 350, def.y + 150, '#22c55e', 14);
      WorldCanvas.spawnFloatingText(def.x + 350, def.y + 120, '🔥 幫孵加速 -20秒！(+10鴨幣)', '#4ade80', 16);
    }

    const msg = `🔥 【${this.currentUser}】好心幫【${targetPlot.owner}】的鴨蛋保溫加速了 20 秒，獲得 +10 友情鴨幣！`;
    this.addLog(msg);
    NetEngine.send('EGG_BLESSED', { plotIndex, eggId, helper: this.currentUser, msg });
    this.saveWorld(true);
    this.renderInspector();
  },

  onRemoteEggBlessed(payload) {
    if (payload && payload.msg) {
      this.addLog(payload.msg, false);
    }
  },

  stealCloneEggWithGraffiti(plotIndex, eggId) {
    const targetPlot = this.world.plots[plotIndex];
    const myPlot = this.getMyPlot();
    if (!targetPlot || !myPlot) return;

    if (myPlot.eggs.length >= myPlot.maxEggs) {
      this.notify('🪺 你的孵化鴨窩已經滿了！先等自己的蛋孵化騰出空間再來偷摸吧！', 'warn');
      return;
    }

    const egg = (targetPlot.eggs || []).find(e => e.id === eggId);
    if (!egg) return;

    if (!egg.stolenBy) egg.stolenBy = [];
    if (egg.stolenBy.includes(this.currentUser)) {
      this.notify('🥸 這顆蛋你已經偷摸過一次基因分身囉！換別顆蛋試試吧！', 'warn');
      return;
    }

    const stamp = GRAFFITI_STAMPS.find(g => g.id === this.selectedGraffitiId) || GRAFFITI_STAMPS[0];
    egg.stolenBy.push(this.currentUser);
    if (!egg.graffiti) egg.graffiti = [];
    egg.graffiti.push({
      thief: this.currentUser,
      icon: stamp.icon,
      name: stamp.name,
      time: Date.now()
    });
    targetPlot.updatedAt = Date.now();

    const hatchSec = egg.isMutated ? HATCH_TIME_MUTATED_SEC : HATCH_TIME_NORMAL_SEC;
    const cloneEgg = {
      id: 'egg_clone_' + Date.now(),
      rarity: egg.rarity,
      isMutated: !!egg.isMutated,
      head: egg.head,
      wing: egg.wing,
      body: egg.body,
      gen: egg.gen || 1,
      totalSec: hatchSec,
      remainingSec: hatchSec,
      parentInfo: `🕵️ 從【${targetPlot.owner}】偷摸的基因分身蛋`,
      graffiti: [],
      blessedBy: [],
      stolenBy: []
    };
    myPlot.eggs.push(cloneEgg);
    myPlot.updatedAt = Date.now();

    const def = WorldCanvas.plotDefinitions[plotIndex];
    if (def) {
      WorldCanvas.spawnBurstParticles(def.x + 350, def.y + 150, '#c084fc', 18);
      WorldCanvas.spawnFloatingText(def.x + 350, def.y + 115, `${stamp.icon} 偷摸分身蛋成功！`, '#f472b6', 18);
    }

    const msg = `🕵️ 怪盜出沒！【${this.currentUser}】潛入【${targetPlot.owner}】的鴨場偷摸了一顆「基因分身蛋」，還在原蛋上畫了【${stamp.icon}${stamp.name}】！`;
    this.addLog(msg);
    NetEngine.send('EGG_STOLEN', { plotIndex, eggId, thief: this.currentUser, stamp, msg });

    this.notify(`🕵️ 成功偷到【${targetPlot.owner}】的基因分身蛋！已放入你的鴨窩倒計時孵化！`, 'success');
    this.saveWorld(true);
    this.renderInspector();
  },

  onRemoteEggStolen(payload) {
    if (payload && payload.msg) {
      this.addLog(payload.msg, false);
      if (this.isMyPlot(payload.plotIndex)) {
        this.notify(`🎨 你的鴨蛋被【${payload.thief}】畫上了 ${payload.stamp.icon} 塗鴉！（原蛋沒有少，去鴨窩看看吧）`, 'info');
      }
    }
  },

  openSocialModal(targetPlotIndex, defaultTab = 'breed') {
    const targetPlot = this.world.plots[targetPlotIndex];
    const myPlot = this.getMyPlot();
    if (!targetPlot || !myPlot) return;

    this.socialTargetPlotIdx = targetPlotIndex;
    this.socialMyDuckId = myPlot.ducks[0] ? myPlot.ducks[0].id : null;
    this.socialTargetDuckId = targetPlot.ducks[0] ? targetPlot.ducks[0].id : null;
    this.socialTab = defaultTab;

    this.renderSocialModal();
    document.getElementById('socialModal').classList.remove('hidden');
  },

  switchSocialTab(tab) {
    this.socialTab = tab;
    this.renderSocialModal();
  },

  renderSocialModal() {
    const targetPlot = this.world.plots[this.socialTargetPlotIdx];
    const myPlot = this.getMyPlot();
    if (!targetPlot || !myPlot) return;

    const isOnline = this.isPlayerOnline(targetPlot.owner);
    document.getElementById('socialModalTitle').innerHTML = `
      🤝 與【${targetPlot.owner}】的鴨場互動
      <span class="status-pill ${isOnline ? 'online' : 'offline'}">${isOnline ? '🟢 在線玩家' : '⚪ 離線保留領地'}</span>
    `;

    document.getElementById('tabBtnBreed').className = `tab-btn ${this.socialTab === 'breed' ? 'active' : ''}`;
    document.getElementById('tabBtnTrade').className = `tab-btn ${this.socialTab === 'trade' ? 'active' : ''}`;

    const myListEl = document.getElementById('socialMyDuckList');
    const targetListEl = document.getElementById('socialTargetDuckList');

    myListEl.innerHTML = myPlot.ducks.map(d => {
      const info = evaluateDuckInfo(d);
      const sel = d.id === this.socialMyDuckId ? 'selected' : '';
      const gSym = d.gender === 'M' ? '♂' : '♀';
      return `
        <div class="duck-pick-item ${sel}" onclick="Game.selectSocialDuck('mine', '${d.id}')">
          <div class="dp-title" style="color:${info.rarity.color}">[${info.rarity.name}] ${gSym}${d.name} (⚔️${info.combatPower})</div>
          <div class="dp-parts">頭:${info.headPart.name} ｜ 翅:${info.wingPart.name} ｜ 身:${info.bodyPart.name}</div>
        </div>
      `;
    }).join('') || '<div class="empty-hint">你的鴨場目前沒有鴨子</div>';

    targetListEl.innerHTML = targetPlot.ducks.map(d => {
      const info = evaluateDuckInfo(d);
      const sel = d.id === this.socialTargetDuckId ? 'selected' : '';
      const gSym = d.gender === 'M' ? '♂' : '♀';
      return `
        <div class="duck-pick-item ${sel}" onclick="Game.selectSocialDuck('target', '${d.id}')">
          <div class="dp-title" style="color:${info.rarity.color}">[${info.rarity.name}] ${gSym}${d.name} (⚔️${info.combatPower})</div>
          <div class="dp-parts">頭:${info.headPart.name} ｜ 翅:${info.wingPart.name} ｜ 身:${info.bodyPart.name}</div>
        </div>
      `;
    }).join('') || '<div class="empty-hint">對方鴨場目前沒有鴨子</div>';

    const actionArea = document.getElementById('socialActionFooter');
    if (this.socialTab === 'breed') {
      actionArea.innerHTML = `
        <div class="social-desc">
          💕 <b>跨場借種相親規則</b>：雙方的鴨子<b>都不會消失</b>！配對後生出<b> 97% 雙親遺傳 / 3% 變異</b>的混血蛋（非變異1分鐘、變異3分鐘自動孵化）！
        </div>
        <div class="social-btn-row">
          ${isOnline ? `
            <button class="btn-lg btn-pink" onclick="Game.confirmCrossBreed(true)">💌 向在線夥伴【${targetPlot.owner}】發送相親邀請 (免費雙贏)</button>
          ` : ''}
          <button class="btn-lg btn-gold" onclick="Game.confirmCrossBreed(false)">⚡ 自助借種相親 (花費 200 鴨幣立即產出混血蛋)</button>
        </div>
      `;
    } else {
      actionArea.innerHTML = `
        <div class="social-desc">
          🔄 <b>點對點交換怪鴨規則</b>：選擇你的一隻鴨子與對方的一隻鴨子直接互換領地，並自動解鎖對應部位圖鑑！
        </div>
        <div class="social-btn-row">
          ${isOnline ? `
            <button class="btn-lg btn-blue" onclick="Game.confirmTradeDuck(true)">🔄 向在線夥伴【${targetPlot.owner}】發起即時交易邀請</button>
          ` : `
            <button class="btn-lg btn-gold" onclick="Game.confirmTradeDuck(false)">🔄 與離線領地【${targetPlot.owner}】交換鴨子 (手續費 300 鴨幣)</button>
          `}
        </div>
      `;
    }
  },

  selectSocialDuck(side, duckId) {
    if (side === 'mine') this.socialMyDuckId = duckId;
    else this.socialTargetDuckId = duckId;
    this.renderSocialModal();
  },

  confirmCrossBreed(sendRequestToOnline) {
    const targetPlot = this.world.plots[this.socialTargetPlotIdx];
    const myPlot = this.getMyPlot();
    const myAcc = this.getMyAccount();
    if (!targetPlot || !myPlot || !myAcc) return;

    const myDuck = myPlot.ducks.find(d => d.id === this.socialMyDuckId);
    const targetDuck = targetPlot.ducks.find(d => d.id === this.socialTargetDuckId);
    if (!myDuck || !targetDuck) {
      this.notify('請先各選一隻要進行相親配對的鴨子！', 'warn');
      return;
    }

    if (myPlot.eggs.length >= myPlot.maxEggs) {
      this.notify('🪺 你的孵化鴨窩已經滿了！請先等鴨蛋孵化騰出空間！', 'warn');
      return;
    }

    const breedCdMs = 180 * 1000;
    const cdLeftSec = Math.ceil(((myAcc.lastCrossBreedAt || 0) + breedCdMs - Date.now()) / 1000);
    if (cdLeftSec > 0) {
      this.notify(`⏱️ 跨場相親冷卻中，請再等 ${formatDurationMMSS(cdLeftSec)}！`, 'warn');
      return;
    }

    if (sendRequestToOnline) {
      myAcc.lastCrossBreedAt = Date.now();
      myAcc.updatedAt = Date.now();
      NetEngine.send('BREED_REQUEST', {
        requester: this.currentUser,
        requesterPlotIdx: myPlot.plotIndex,
        targetOwner: targetPlot.owner,
        targetPlotIdx: targetPlot.plotIndex,
        myDuck,
        targetDuck
      });
      this.saveWorld(true);
      this.notify(`💌 已向【${targetPlot.owner}】發送跨場相親邀請，等待對方同意！（冷卻 3 分鐘）`, 'info');
      document.getElementById('socialModal').classList.add('hidden');
      return;
    }

    if ((myAcc.coins || 0) < 200) {
      this.notify('💰 鴨幣不足 200！', 'warn');
      return;
    }

    myAcc.coins -= 200;
    myAcc.lastCrossBreedAt = Date.now();
    myAcc.updatedAt = Date.now();
    const hybridEgg = this.generateOffspringEgg(
      myDuck,
      targetDuck,
      MUTATED_EGG_CHANCE,
      `💕 跨場相親 (${myDuck.name} × ${targetPlot.owner}的${targetDuck.name})`
    );
    myPlot.eggs.push(hybridEgg);
    myPlot.updatedAt = Date.now();

    const targetAcc = this.world.accounts[targetPlot.owner];
    if (targetAcc) {
      if (!targetAcc.mailbox) targetAcc.mailbox = [];
      targetAcc.mailbox.push({
        coins: 120,
        egg: JSON.parse(JSON.stringify(hybridEgg)),
        message: `【${this.currentUser}】向你的「${targetDuck.name}」自助借種相親，贈送你 +120 鴨幣與 1 顆混血相親蛋！`
      });
      targetAcc.updatedAt = Date.now();
    }

    document.getElementById('socialModal').classList.add('hidden');
    this.addLog(`💕 跨場借種成功！你的「${myDuck.name}」與【${targetPlot.owner}】的「${targetDuck.name}」生出了一顆【${RARITIES[hybridEgg.rarity].name}混血相親蛋】！`);
    this.notify('💕 相親成功！混血蛋已放入你的鴨窩開始倒計時孵化！', 'success');
    this.saveWorld(true);
  },

  onReceiveBreedRequest(payload) {
    this.pendingInteraction = { mode: 'breed', ...payload };
    const box = document.getElementById('incomingRequestBanner');
    const txt = document.getElementById('incomingRequestText');
    txt.innerHTML = `💕 玩家【<b>${payload.requester}</b>】想讓他的「${payload.myDuck.name}」跟你的「${payload.targetDuck.name}」跨場相親！（雙方各得 1 顆 85% 雙親遺傳混血蛋）`;
    box.classList.remove('hidden');
  },

  onBreedRequestAccepted(payload) {
    const myPlot = this.getMyPlot();
    if (!myPlot) return;
    if (myPlot.eggs.length >= myPlot.maxEggs) {
      this.notify(`⚠️ 對方同意了相親，但你的鴨窩已滿 (${myPlot.eggs.length}/${myPlot.maxEggs})，無法再放入新蛋！`, 'warn');
      return;
    }
    const hybridEgg = this.generateOffspringEgg(
      payload.myDuck,
      payload.targetDuck,
      MUTATED_EGG_CHANCE,
      `💕 跨場相親 (${payload.myDuck.name} × ${payload.targetDuck.name})`
    );
    myPlot.eggs.push(hybridEgg);
    myPlot.updatedAt = Date.now();
    this.addLog(`🎉 【${payload.targetOwner}】同意了你的相親請求！你們各獲得了一顆混血相親蛋！`);
    this.notify('🎉 對方同意相親！混血蛋已放入你的鴨窩開始倒計時孵化！', 'success');
    this.saveWorld(true);
  },

  confirmTradeDuck(sendRequestToOnline) {
    const targetPlot = this.world.plots[this.socialTargetPlotIdx];
    const myPlot = this.getMyPlot();
    const myAcc = this.getMyAccount();
    if (!targetPlot || !myPlot || !myAcc) return;

    const myDuckIdx = myPlot.ducks.findIndex(d => d.id === this.socialMyDuckId);
    const targetDuckIdx = targetPlot.ducks.findIndex(d => d.id === this.socialTargetDuckId);
    if (myDuckIdx === -1 || targetDuckIdx === -1) {
      this.notify('請先選擇雙方要交換的鴨子！', 'warn');
      return;
    }

    const myDuck = myPlot.ducks[myDuckIdx];
    const targetDuck = targetPlot.ducks[targetDuckIdx];

    if (myDuck.locked) {
      this.notify('🔒 你的這隻鴨子處於鎖定保護狀態，請先解鎖再交換！', 'warn');
      return;
    }

    if (sendRequestToOnline) {
      NetEngine.send('TRADE_PROPOSAL', {
        requester: this.currentUser,
        requesterPlotIdx: myPlot.plotIndex,
        targetOwner: targetPlot.owner,
        targetPlotIdx: targetPlot.plotIndex,
        myDuck,
        targetDuck
      });
      this.notify(`🔄 已向【${targetPlot.owner}】發送交換鴨子邀請，等待對方確認！`, 'info');
      document.getElementById('socialModal').classList.add('hidden');
      return;
    }

    if ((myAcc.coins || 0) < 300) {
      this.notify('💰 交換手續費需要 300 鴨幣！', 'warn');
      return;
    }

    myAcc.coins -= 300;
    this.executeDuckSwap(myPlot.plotIndex, myDuck.id, targetPlot.plotIndex, targetDuck.id);
    document.getElementById('socialModal').classList.add('hidden');
  },

  executeDuckSwap(plotIdxA, duckIdA, plotIdxB, duckIdB) {
    const plotA = this.world.plots[plotIdxA];
    const plotB = this.world.plots[plotIdxB];
    if (!plotA || !plotB) return;

    const idxA = plotA.ducks.findIndex(d => d.id === duckIdA);
    const idxB = plotB.ducks.findIndex(d => d.id === duckIdB);
    if (idxA === -1 || idxB === -1) return;

    const duckA = plotA.ducks[idxA];
    const duckB = plotB.ducks[idxB];

    plotA.ducks[idxA] = duckB;
    plotB.ducks[idxB] = duckA;
    plotA.updatedAt = Date.now();
    plotB.updatedAt = Date.now();

    if (this.isMyPlot(plotIdxA)) this.unlockCompendiumForDuck(duckB);
    if (this.isMyPlot(plotIdxB)) this.unlockCompendiumForDuck(duckA);
    this.ensureValidSquad();

    this.addLog(`🔄 交易完成！【${plotA.owner}】的「${duckA.name}」與【${plotB.owner}】的「${duckB.name}」已完成互換！`);
    this.notify('🎉 怪鴨交換成功！已同步更新圖鑑與戰隊！', 'success');
    this.saveWorld(true);
  },

  onReceiveTradeProposal(payload) {
    this.pendingInteraction = { mode: 'trade', ...payload };
    const box = document.getElementById('incomingRequestBanner');
    const txt = document.getElementById('incomingRequestText');
    txt.innerHTML = `🔄 玩家【<b>${payload.requester}</b>】想用他的「${payload.myDuck.name}」交換你的「${payload.targetDuck.name}」！`;
    box.classList.remove('hidden');
  },

  acceptIncomingInteraction() {
    const req = this.pendingInteraction;
    document.getElementById('incomingRequestBanner').classList.add('hidden');
    if (!req) return;

    if (req.mode === 'boss_invite') {
      this.joinActiveBossRaid();
    } else if (req.mode === 'breed') {
      const myPlot = this.getMyPlot();
      if (myPlot && myPlot.eggs.length >= myPlot.maxEggs) {
        this.notify(`🪺 你的孵化鴨窩已滿 (${myPlot.eggs.length}/${myPlot.maxEggs})，請先孵出蛋騰出空間再相親！`, 'warn');
        this.pendingInteraction = null;
        return;
      }
      if (myPlot) {
        const egg = this.generateOffspringEgg(req.myDuck, req.targetDuck, MUTATED_EGG_CHANCE, `💕 跨場相親 (${req.myDuck.name} × ${req.targetDuck.name})`);
        myPlot.eggs.push(egg);
        myPlot.updatedAt = Date.now();
      }
      NetEngine.send('BREED_ACCEPTED', req);
      this.notify('💕 已同意相親！混血相親蛋已放入你的鴨窩開始倒計時孵化！', 'success');
      this.saveWorld(true);
    } else if (req.mode === 'trade') {
      this.executeDuckSwap(req.requesterPlotIdx, req.myDuck.id, req.targetPlotIdx, req.targetDuck.id);
      NetEngine.send('TRADE_COMPLETED', req);
    }
    this.pendingInteraction = null;
  },

  rejectIncomingInteraction() {
    this.pendingInteraction = null;
    document.getElementById('incomingRequestBanner').classList.add('hidden');
  },

  onTradeCompleted(payload) {
    this.addLog(`🔄 【${payload.requester}】與【${payload.targetOwner}】完成了線上怪鴨交易！`, false);
  },

  // ==========================================================================
  // 地圖點擊與右側詳細檢視面板 (Inspector)
  // ==========================================================================
  onEntityClicked(hit) {
    if (!hit) return;

    if (hit.type === 'pit') {
      this.onClickCentralPit();
      return;
    }

    if (hit.type === 'breedNowBtn') {
      this.autoAssignBreedersOrRescue();
      return;
    }

    if (hit.type === 'plotAction') {
      this.openSocialModal(hit.plotIndex, 'breed');
      return;
    }

    if (hit.type === 'egg') {
      if (this.isMyPlot(hit.plotIndex) && (hit.egg.remainingSec || 0) <= 0) {
        this.hatchEggById(hit.egg.id);
        return;
      }
      this.onSelectEntity(hit);
      return;
    }

    if (hit.type === 'duck') {
      this.onSelectEntity(hit);
      return;
    }
  },

  onSelectEntity(entity) {
    this.selectedEntity = entity;
    WorldCanvas.selectedEntity = entity;
    this.renderInspector();
  },

  closeInspector() {
    this.selectedEntity = null;
    WorldCanvas.selectedEntity = null;
    const panel = document.getElementById('inspectorPanel');
    if (panel) panel.classList.add('hidden');
  },

  renderInspector() {
    const panel = document.getElementById('inspectorPanel');
    const content = document.getElementById('inspectorContent');
    if (!this.selectedEntity || !panel || !content) return;

    panel.classList.remove('hidden');
    const ent = this.selectedEntity;
    const plot = this.world.plots[ent.plotIndex];
    const isMine = this.isMyPlot(ent.plotIndex);
    const acc = this.getMyAccount();

    if (ent.type === 'duck') {
      const d = ent.duck;
      const info = evaluateDuckInfo(d);
      const isMale = d.gender !== 'F';
      const genderBadge = isMale
        ? `<span style="color:#38bdf8;font-weight:900;">♂ 公鴨</span>`
        : `<span style="color:#f472b6;font-weight:900;">♀ 母鴨</span>`;
      const breedRoomIdx = plot ? this.getDuckBreedRoomIndex(plot, d.id) : -1;
      const inBreedPen = breedRoomIdx >= 0;
      const inSquad = isMine && acc && (acc.squadIds || []).includes(d.id);

      content.innerHTML = `
        <div class="insp-header">
          <span class="rarity-tag" style="background:${info.rarity.bg};color:${info.rarity.color};border-color:${info.rarity.border}">
            ${info.rarity.name}怪鴨 (第 ${d.gen || 1} 代)
          </span>
          <button class="btn-close" onclick="Game.closeInspector()">✕</button>
        </div>
        <div class="insp-portrait-wrap">
          <canvas id="inspectorDuckCanvas" width="130" height="130"></canvas>
        </div>
        <div class="insp-title" style="color:${info.rarity.color}">
          ${d.locked ? '🔒 ' : ''}${d.name} (${genderBadge})
        </div>
        <div style="text-align:center;font-size:15px;font-weight:900;color:#fde047;margin:4px 0;">
          ⚔️ 戰鬥力：${info.combatPower.toLocaleString()} ｜ 絕招：${info.skillName}
        </div>
        <div class="insp-owner">所屬領地：【${plot ? plot.owner : '未知'}】${inBreedPen ? ` (💕目前在交配室 #${breedRoomIdx + 1})` : ''}</div>
        ${info.isFullSet ? `
          <div class="set-awakened-box">
            👑 <b>套裝覺醒 (戰力 1.5 倍加成)：《${info.matchedSet.setName}》</b><br>
            <span>${info.matchedSet.setDesc}</span>
          </div>
        ` : ''}
        <div class="gene-parts-list">
          <div class="gene-row">
            <span class="g-type">🗣️ 頭部 (+${info.headPart.power}戰力)</span>
            <span class="g-name" style="color:${RARITIES[info.headPart.rarity].color}">[${RARITIES[info.headPart.rarity].name}] ${info.headPart.name}</span>
          </div>
          <div class="gene-row">
            <span class="g-type">🪽 翅膀 (+${info.wingPart.power}戰力)</span>
            <span class="g-name" style="color:${RARITIES[info.wingPart.rarity].color}">[${RARITIES[info.wingPart.rarity].name}] ${info.wingPart.name}</span>
          </div>
          <div class="gene-row">
            <span class="g-type">🦆 身體 (+${info.bodyPart.power}戰力)</span>
            <span class="g-name" style="color:${RARITIES[info.bodyPart.rarity].color}">[${RARITIES[info.bodyPart.rarity].name}] ${info.bodyPart.name}</span>
          </div>
        </div>
        <div class="insp-actions">
          ${isMine ? `
            ${inBreedPen ? `
              <button class="btn-md btn-outline" onclick="Game.removeDuckFromBreedZone('${d.id}')">
                🌿 移出生蛋交配區（放回草地）
              </button>
            ` : `
              <button class="btn-md btn-pink" onclick="Game.assignDuckToBreedZone('${d.id}')">
                💕 送入右上【生蛋交配區】(${isMale ? '♂公鴨位' : '♀母鴨位'})
              </button>
            `}
            <button class="btn-md btn-blue" onclick="Game.toggleDuckInSquad('${d.id}')">
              ${inSquad ? '⚔️ 已在 3 隻出戰隊伍中 (點擊移出)' : '⚔️ 編入 3 隻出戰小隊'}
            </button>
            <div style="display:flex;gap:6px;">
              <button class="btn-sm btn-outline" style="flex:1" onclick="Game.toggleLockDuck('${d.id}')">
                ${d.locked ? '🔓 解鎖' : '🔒 鎖定保護'}
              </button>
              <button class="btn-sm btn-outline" style="flex:1" onclick="Game.renameMyDuck('${d.id}')">✏️ 改名</button>
            </div>
            <button class="btn-md btn-danger" onclick="Game.sacrificeDuckToPit('${d.id}')">
              🕳️ 丟進中央大黑洞 (+${info.rarity.sacrificeValue}幣) [空白鍵]
            </button>
          ` : `
            <button class="btn-md btn-pink" onclick="Game.openSocialWithDuck(${ent.plotIndex}, '${d.id}', 'breed')">
              💕 跟這隻鴨跨場借種相親
            </button>
            <button class="btn-md btn-blue" onclick="Game.openSocialWithDuck(${ent.plotIndex}, '${d.id}', 'trade')">
              🔄 申請點對點交換這隻鴨
            </button>
          `}
        </div>
      `;

      setTimeout(() => {
        const cEl = document.getElementById('inspectorDuckCanvas');
        if (cEl) WorldCanvas.renderDuckPortrait(cEl, d);
      }, 20);

    } else if (ent.type === 'egg') {
      const egg = ent.egg;
      const rObj = RARITIES[egg.rarity] || RARITIES.common;
      const remSec = this.getEffectiveEggRemainingSec(plot, egg);
      const ownerOnline = plot && plot.owner ? this.isPlayerOnline(plot.owner) : false;
      const eggTypeBadge = egg.isMutated
        ? `<span style="color:#c084fc;font-weight:900;">🧬 基因變異蛋 (3分鐘孵化)</span>`
        : `<span style="color:#fde047;font-weight:900;">🥚 一般遺傳蛋 (1分鐘孵化)</span>`;
      const hatchStatusText = remSec <= 0
        ? `🥚 待孵化！（點擊蛋或下方按鈕破殼）`
        : `${formatDurationMMSS(remSec)}`;

      const graffitiHtml = (egg.graffiti && egg.graffiti.length > 0)
        ? egg.graffiti.map(g => `<div class="graffiti-log">${g.icon} 被【${g.thief}】畫上「${g.name}」</div>`).join('')
        : '<div class="graffiti-log">✨ 蛋殼目前很乾淨，還沒被怪盜塗鴉過</div>';

      const stampPickerHtml = GRAFFITI_STAMPS.map(st => `
        <button class="stamp-btn ${this.selectedGraffitiId === st.id ? 'active' : ''}"
                onclick="Game.selectGraffitiStamp('${st.id}')">
          ${st.icon} ${st.name}
        </button>
      `).join('');

      content.innerHTML = `
        <div class="insp-header">
          <span class="rarity-tag" style="background:${rObj.bg};color:${rObj.color};border-color:${rObj.border}">
            🥚 ${rObj.name}鴨蛋
          </span>
          <button class="btn-close" onclick="Game.closeInspector()">✕</button>
        </div>
        <div class="insp-title" style="color:${rObj.color}">【${plot ? plot.owner : '夥伴'}】鴨窩裡的蛋</div>
        <div style="text-align:center;font-size:13px;margin:6px 0;">${eggTypeBadge}</div>
        <div style="text-align:center;font-size:16px;font-weight:900;color:#4ade80;margin-bottom:8px;">
          ⏱️ 孵化狀態：${hatchStatusText}
        </div>
        ${isMine && remSec <= 0 ? `
          <button class="btn-md btn-gold full-w" style="margin-bottom:10px;" onclick="Game.hatchEggById('${egg.id}')">
            🐣 點擊孵化這顆蛋
          </button>
        ` : ''}
        <div class="insp-owner">來源：${egg.parentInfo || '雙親交配'}</div>
        <div class="graffiti-box">
          <div class="gb-title">🎨 蛋殼塗鴉紀錄：</div>
          ${graffitiHtml}
        </div>
        ${!isMine ? `
          <div class="steal-section">
            <div class="ss-title">🕵️ 選擇惡作劇塗鴉貼紙（偷摸基因分身蛋，原蛋不會消失）：</div>
            <div class="stamp-grid">${stampPickerHtml}</div>
            <button class="btn-md btn-pink full-w" onclick="Game.stealCloneEggWithGraffiti(${ent.plotIndex}, '${egg.id}')">
              🕵️ 偷摸「基因分身蛋」並畫上塗鴉！
            </button>
            <button class="btn-md btn-gold full-w" style="margin-top:6px;" onclick="Game.blessNeighborEgg(${ent.plotIndex}, '${egg.id}')">
              🔥 好心幫孵加速 -20秒 (獎勵 +10 鴨幣)
            </button>
          </div>
        ` : ''}
      `;
    }
  },

  selectGraffitiStamp(stampId) {
    this.selectedGraffitiId = stampId;
    this.renderInspector();
  },

  openSocialWithDuck(plotIndex, duckId, tab) {
    this.openSocialModal(plotIndex, tab);
    this.socialTargetDuckId = duckId;
    this.renderSocialModal();
  },

  toggleLockDuck(duckId) {
    const plot = this.getMyPlot();
    if (!plot) return;
    const d = plot.ducks.find(x => x.id === duckId);
    if (!d) return;
    d.locked = !d.locked;
    this.saveWorld(true);
    this.renderInspector();
  },

  renameMyDuck(duckId) {
    const plot = this.getMyPlot();
    if (!plot) return;
    const d = plot.ducks.find(x => x.id === duckId);
    if (!d) return;
    const newName = prompt('請為這隻怪鴨輸入新名字（最多10字）：', d.name);
    if (newName && newName.trim()) {
      d.name = newName.trim().slice(0, 10);
      this.saveWorld(true);
      this.renderInspector();
    }
  },

  // ==========================================================================
  // 鴨場升級商店與獵奇圖鑑
  // ==========================================================================
  openUpgradeModal() {
    this.renderUpgradeModal();
    document.getElementById('upgradeModal').classList.remove('hidden');
  },

  renderUpgradeModal() {
    const acc = this.getMyAccount();
    const plot = this.getMyPlot();
    if (!acc || !plot) return;

    const mutCost = (acc.mutationLv || 1) * 1200;
    const breedSpeedLv = acc.breedSpeedLv || 1;
    const curBreedSec = this.getPlotBreedTimeSec(plot);
    const isMaxBreedSpeed = curBreedSec <= 30;
    const breedSpeedCost = breedSpeedLv * 1000;
    const duckCapCost = Math.max(800, ((plot.maxDucks || 24) - 20) * 320);
    const eggCapCost = Math.max(700, ((plot.maxEggs || 12) - 10) * 380);

    document.getElementById('upgradeListContainer').innerHTML = `
      <div class="upg-card">
        <div>
          <div class="upg-name">💕 交配室產卵加速 (目前 Lv.${breedSpeedLv}｜${curBreedSec} 秒/顆)</div>
          <div class="upg-desc">每次升級可小幅縮短交配室產卵時間 <b>-3 秒</b>（最低可加速至 30 秒/顆）！</div>
        </div>
        ${isMaxBreedSpeed
          ? `<button class="btn-md btn-outline" disabled>✅ 已滿級</button>`
          : `<button class="btn-md btn-gold" onclick="Game.buyUpgrade('breedSpeed', ${breedSpeedCost})">💰 ${breedSpeedCost.toLocaleString()} 升級</button>`
        }
      </div>
      <div class="upg-card">
        <div>
          <div class="upg-name">🧬 突變高階基因研究所 (目前 Lv.${acc.mutationLv || 1})</div>
          <div class="upg-desc">生蛋交配區維持 97% 雙親遺傳 / 3% 基因變異，升級可提升變異時罕見/勁爆/傳奇基因權重 (Lv.3 解鎖極低機率詛咒突變)！</div>
        </div>
        <button class="btn-md btn-gold" onclick="Game.buyUpgrade('mutation', ${mutCost})">💰 ${mutCost.toLocaleString()} 升級</button>
      </div>
      <div class="upg-card">
        <div>
          <div class="upg-name">🏡 擴建巨型鴨場容量 (目前上限 ${plot.maxDucks || 24} 隻)</div>
          <div class="upg-desc">每次擴建 +6 隻怪鴨容量，滿足後期大規模養殖與配種需求！</div>
        </div>
        <button class="btn-md btn-gold" onclick="Game.buyUpgrade('maxDucks', ${duckCapCost})">💰 ${duckCapCost.toLocaleString()} 擴建</button>
      </div>
      <div class="upg-card">
        <div>
          <div class="upg-name">🪺 擴建孵化鴨窩容量 (目前上限 ${plot.maxEggs || 12} 顆蛋)</div>
          <div class="upg-desc">每次擴建 +4 顆蛋位，可同時讓更多一般蛋(1分)與變異蛋(3分)倒計時孵化！</div>
        </div>
        <button class="btn-md btn-gold" onclick="Game.buyUpgrade('maxEggs', ${eggCapCost})">💰 ${eggCapCost.toLocaleString()} 擴建</button>
      </div>
    `;
  },

  buyUpgrade(type, cost) {
    const acc = this.getMyAccount();
    const plot = this.getMyPlot();
    if (!acc || !plot) return;

    if ((acc.coins || 0) < cost) {
      this.notify('💰 鴨幣不足！可透過組隊打 Boss 或把淘汰鴨丟進黑洞賺取鴨幣！', 'warn');
      return;
    }

    acc.coins -= cost;
    if (type === 'breedSpeed') {
      if (this.getPlotBreedTimeSec(plot) <= 30) {
        acc.coins += cost;
        this.notify('💕 交配室產卵速度已達上限 (30秒/顆)！', 'info');
        return;
      }
      acc.breedSpeedLv = (acc.breedSpeedLv || 1) + 1;
      acc.updatedAt = Date.now();
      this.notify(`💕 交配室產卵速度提升至 Lv.${acc.breedSpeedLv}（每 ${this.getPlotBreedTimeSec(plot)} 秒產卵）！`, 'success');
    } else if (type === 'mutation') {
      acc.mutationLv = (acc.mutationLv || 1) + 1;
      this.notify(`🧬 突變研究所已提升至 Lv.${acc.mutationLv}！`, 'success');
    } else if (type === 'maxDucks') {
      plot.maxDucks = (plot.maxDucks || 24) + 6;
      acc.maxDucks = plot.maxDucks;
      this.notify(`🏡 巨型鴨場容量已擴建至 ${plot.maxDucks} 隻！`, 'success');
    } else if (type === 'maxEggs') {
      plot.maxEggs = (plot.maxEggs || 12) + 4;
      acc.maxEggs = plot.maxEggs;
      this.notify(`🪺 孵化鴨窩容量已擴建至 ${plot.maxEggs} 顆蛋！`, 'success');
    }

    this.saveWorld(true);
    this.renderUpgradeModal();
  },

  buyMysteryEgg(cost) {
    const acc = this.getMyAccount();
    const plot = this.getMyPlot();
    if (!acc || !plot) return;

    if (plot.eggs.length >= plot.maxEggs) {
      this.notify('🪺 鴨窩已經滿了，請先等鴨蛋孵化騰出空間！', 'warn');
      return;
    }
    if ((acc.coins || 0) < cost) {
      this.notify(`💰 鴨幣不足 ${cost}！`, 'warn');
      return;
    }

    acc.coins -= cost;
    const head = this.rollMutatedPart('head', (acc.mutationLv || 1) + 1);
    const wing = this.rollMutatedPart('wing', (acc.mutationLv || 1) + 1);
    const body = this.rollMutatedPart('body', (acc.mutationLv || 1) + 1);
    const info = evaluateDuckInfo({ head, wing, body });

    plot.eggs.push({
      id: 'egg_mystery_' + Date.now(),
      rarity: info.rarityKey,
      isMutated: true,
      head,
      wing,
      body,
      gen: 3,
      totalSec: HATCH_TIME_MUTATED_SEC,
      remainingSec: HATCH_TIME_MUTATED_SEC,
      parentInfo: '🧪 實驗室變異蛋 (3分鐘自動孵化)',
      graffiti: [],
      blessedBy: [],
      stolenBy: []
    });

    this.notify(`🧪 已購買【${info.rarity.name}】變異蛋放入鴨窩（倒計時 3 分鐘自動孵化）！`, 'success');
    this.saveWorld(true);
    this.renderUpgradeModal();
  },

  openCompendiumModal() {
    const acc = this.getMyAccount();
    if (!acc) return;
    const unlockedP = acc.unlockedParts || {};
    const unlockedS = acc.unlockedSets || {};

    const totalParts = DUCK_SETS.length * 3;
    const unlockedCount = Object.keys(unlockedP).length;
    const setCount = Object.keys(unlockedS).length;

    document.getElementById('compendiumStats').textContent =
      `已收集部位：${unlockedCount} / ${totalParts} ｜ 套裝覺醒：${setCount} / ${DUCK_SETS.length}`;

    const grid = document.getElementById('compendiumGrid');
    grid.innerHTML = DUCK_SETS.map(s => {
      const rObj = RARITIES[s.rarity];
      const hasH = !!unlockedP[s.head.id];
      const hasW = !!unlockedP[s.wing.id];
      const hasB = !!unlockedP[s.body.id];
      const hasSet = !!unlockedS[s.setId] || (hasH && hasW && hasB);
      const setBasePower = Math.round((s.head.power + s.wing.power + s.body.power) * 1.5);

      return `
        <div class="comp-card" style="border-color:${hasSet ? rObj.color : '#334155'}">
          <div class="comp-header">
            <span class="rarity-tag" style="background:${rObj.bg};color:${rObj.color};border-color:${rObj.border}">${rObj.name}</span>
            <span class="comp-set-name" style="color:${hasSet ? rObj.color : '#94a3b8'}">
              ${hasSet ? '👑 ' + s.setName : '🔒 ' + s.setName}
            </span>
          </div>
          <div style="font-size:11px;color:#fde047;margin-bottom:4px;">⚔️ 湊齊套裝基礎戰力：${setBasePower} ｜ 絕招：${s.skillName}</div>
          <div class="comp-desc">${s.setDesc}</div>
          <div class="comp-parts">
            <div class="cp-item ${hasH ? 'unlocked' : 'locked'}">🗣️ 頭 (+${s.head.power})：${hasH ? s.head.name : '？？？(未解鎖)'}</div>
            <div class="cp-item ${hasW ? 'unlocked' : 'locked'}">🪽 翅 (+${s.wing.power})：${hasW ? s.wing.name : '？？？(未解鎖)'}</div>
            <div class="cp-item ${hasB ? 'unlocked' : 'locked'}">🦆 身 (+${s.body.power})：${hasB ? s.body.name : '？？？(未解鎖)'}</div>
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('compendiumModal').classList.remove('hidden');
  },

  updateHUD() {
    const acc = this.getMyAccount();
    const plot = this.getMyPlot();
    if (acc && plot) {
      document.getElementById('hudUsername').textContent = `${acc.username} (領地 #${acc.plotIndex + 1})`;
      document.getElementById('hudCoins').textContent = (acc.coins || 0).toLocaleString();
      document.getElementById('hudDuckCount').textContent = `${plot.ducks.length} / ${plot.maxDucks}`;
      document.getElementById('hudEggCount').textContent = `${plot.eggs.length} / ${plot.maxEggs}`;
      document.getElementById('hudSquadPower').textContent = this.getMySquadTotalPower().toLocaleString();
    }

    if (this.world) {
      const raid = this.world.bossRaid;
      const sac = this.ensurePitSacrifices();
      const pitTxt = document.getElementById('hudPitStatus');
      if (pitTxt) {
        pitTxt.textContent = (raid && raid.active)
          ? `🐙 共鬥中 HP: ${Math.ceil(raid.bossHp).toLocaleString()} (${raid.remainingSec ?? 90}s)`
          : `🕳️ 祭品(需30): 普${sac.total || 0} 藍${sac.rarePlus || 0} 紫${sac.epicPlus || 0} 金${sac.legendaryOrSet || 0} 紅${sac.cursedOrHighSet || 0}`;
      }
    }
  },

  updateOnlinePlayersUI() {
    const listEl = document.getElementById('worldPlotsDirectory');
    if (!listEl || !this.world) return;

    const items = [];
    this.world.plots.forEach((p, idx) => {
      if (!p || !p.owner) return;
      const isMine = this.isMyPlot(idx);
      const isOnline = this.isPlayerOnline(p.owner);
      const badge = isMine ? '🏠 我的領地' : (isOnline ? '🟢 連線在線' : '⚪ 離線保留');
      const pwr = this.getPlotTotalPower(p);
      items.push(`
        <div class="dir-plot-item ${isMine ? 'mine' : ''}" onclick="WorldCanvas.focusOnPlot(${idx}, 0.72)">
          <div>
            <div>${badge} <b>${p.owner}</b> (#${idx + 1})</div>
            <div style="font-size:11px;color:#fde047;margin-top:2px;">⚔️ 領地總戰力: ${pwr.toLocaleString()}</div>
          </div>
          <span class="dir-meta">🦆${(p.ducks || []).length} 🥚${(p.eggs || []).length}</span>
        </div>
      `);
    });

    if (items.length === 1) {
      items.push(`
        <div class="dir-plot-item" onclick="WorldCanvas.focusOnPlot(1, 0.72)">
          <span style="color:#94a3b8;">🪧 2號巨型領地 (等待第2位玩家登入)</span>
        </div>
      `);
    }

    listEl.innerHTML = items.join('');
  },

  addLog(msg, sync = false) {
    const box = document.getElementById('worldEventLog');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'log-line';
    const time = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    div.textContent = `[${time}] ${msg}`;
    box.prepend(div);
    while (box.children.length > 35) {
      box.removeChild(box.lastChild);
    }
    if (sync) {
      NetEngine.send('CHAT_LOG', { msg });
    }
  },

  sendChatMessage() {
    const inp = document.getElementById('chatInput');
    if (!inp || !inp.value.trim()) return;
    const text = inp.value.trim();
    inp.value = '';
    const msg = `💬 【${this.currentUser || '訪客'}】：${text}`;
    this.addLog(msg, true);
  },

  notify(text, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast-msg ${type}`;
    el.textContent = text;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 3500);
  }
};

window.Game = Game;
window.addEventListener('DOMContentLoaded', () => Game.init());
window.addEventListener('keydown', (ev) => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (document.querySelector('.modal-backdrop:not(.hidden)')) return;

  if (ev.code === 'KeyH' || (ev.key && ev.key.toLowerCase() === 'h')) {
    ev.preventDefault();
    Game.hatchAllReadyEggs();
    return;
  }

  if (ev.code !== 'Space' && ev.key !== ' ') return;
  if (
    Game.selectedEntity &&
    Game.selectedEntity.type === 'duck' &&
    Game.selectedEntity.plotIndex === Game.getMyPlotIndex() &&
    Game.selectedEntity.duck
  ) {
    ev.preventDefault();
    Game.sacrificeDuckToPit(Game.selectedEntity.duck.id);
  }
});
