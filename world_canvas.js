// ============================================================================
// 《蛋裡是什麼鴨：雙人連線大農場 ＆ Boss 共鬥版》
// 2D 巨型雙領地世界引擎、專屬【生蛋交配區 (♂/♀拖曳產卵)】、組隊 Boss 戰場與怪鴨渲染引擎
// ============================================================================

const WorldCanvas = {
  canvas: null,
  ctx: null,
  width: 0,
  height: 0,

  camera: {
    x: 0,
    y: 0,
    zoom: 0.68,
    minZoom: 0.30,
    maxZoom: 1.65,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    camStartX: 0,
    camStartY: 0,
    movedDist: 0
  },

  draggedDuck: null,
  hoveredEntity: null,
  selectedEntity: null,

  particles: [],
  floatingTexts: [],
  flyingDucks: [],
  projectiles: [], // 戰鴨攻擊 Boss 的飛彈光束

  // 專為雙人連線設計的巨型領地配置 (左右對稱拱衛中央大黑洞 Boss 競技場)
  // 每個領地高達 1120 x 820，後期養 40~60 隻鴨子依然寬敞舒適！
  plotDefinitions: [
    { index: 0, x: -960, y: 0, label: '西方巨型牧場領地 #1' },
    { index: 1, x: 960, y: 0, label: '東方巨型牧場領地 #2' },
    { index: 2, x: 0, y: -880, label: '北方擴充牧場領地 #3' },
    { index: 3, x: 0, y: 880, label: '南方擴充牧場領地 #4' }
  ],
  PLOT_W: 1120,
  PLOT_H: 820,
  PIT_RADIUS: 235,

  // 領地內部功能分區局部座標 (以領地中心 (0,0) 為基準，範圍 x: -560~+560, y: -410~+410)
  // 1. 右上角：💕 生蛋交配區 (支援 3 組公母交配室 #1 ~ #3)
  BREED_ZONE: {
    x: 175,
    y: -380,
    w: 360,
    h: 355
  },
  // 2. 右下角：🪺 大型孵化鴨窩區 (Hatchery Nest)
  NEST_ZONE: {
    x: 175,
    y: -10,
    w: 360,
    h: 390
  },
  // 3. 左側與中央：超寬敞放牧大草地 (x: -520 ~ +155, y: -340 ~ +360)
  PASTURE_BOUNDS: {
    minX: -510,
    maxX: 145,
    minY: -330,
    maxY: 350
  },

  decorations: [],

  init() {
    this.canvas = document.getElementById('worldCanvas');
    this.ctx = this.canvas.getContext('2d');

    this.generateDecorations();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.bindEvents();
    requestAnimationFrame((ts) => this.loop(ts));
  },

  generateDecorations() {
    this.decorations = [];
    for (let i = 0; i < 180; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 300 + Math.random() * 1700;
      const x = Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist;
      this.decorations.push({
        x,
        y,
        type: Math.random() < 0.65 ? 'grass' : (Math.random() < 0.7 ? 'flower' : 'stone'),
        color: ['#fde047', '#f472b6', '#60a5fa', '#c084fc'][Math.floor(Math.random() * 4)],
        scale: 0.8 + Math.random() * 0.6
      });
    }
  },

  resize() {
    if (!this.canvas) return;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.camera.x) * this.camera.zoom + this.width / 2,
      y: (wy - this.camera.y) * this.camera.zoom + this.height / 2
    };
  },

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.width / 2) / this.camera.zoom + this.camera.x,
      y: (sy - this.height / 2) / this.camera.zoom + this.camera.y
    };
  },

  focusOnPlot(plotIndex, targetZoom = 0.72) {
    const def = this.plotDefinitions[plotIndex];
    if (!def) return;
    this.camera.x = def.x;
    this.camera.y = def.y;
    this.camera.zoom = targetZoom;
  },

  focusOnPit() {
    this.camera.x = 0;
    this.camera.y = 0;
    this.camera.zoom = 0.76;
  },

  adjustZoom(delta) {
    this.camera.zoom = Math.max(this.camera.minZoom, Math.min(this.camera.maxZoom, this.camera.zoom + delta));
  },

  isInsideBreedZone(rx, ry) {
    const bz = this.BREED_ZONE;
    return rx >= bz.x && rx <= bz.x + bz.w && ry >= bz.y && ry <= bz.y + bz.h;
  },

  getBreedRoomSlotPos(roomIdx, gender) {
    const bz = this.BREED_ZONE;
    const roomTop = bz.y + 50 + roomIdx * 86;
    return {
      x: gender === 'M' ? (bz.x + 76) : (bz.x + bz.w - 76),
      y: roomTop + 42
    };
  },

  getBreedRoomIndexAt(rx, ry) {
    const bz = this.BREED_ZONE;
    if (!this.isInsideBreedZone(rx, ry)) return -1;
    const relY = ry - (bz.y + 50);
    if (relY < 86) return 0;
    if (relY < 172) return 1;
    return 2;
  },

  bindEvents() {
    const c = this.canvas;

    c.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const wPos = this.screenToWorld(sx, sy);

      const hit = this.hitTest(wPos.x, wPos.y);
      // 允許玩家拖曳自己領地的鴨子（可拖進生蛋交配區、移出生蛋區、或丟進黑洞）
      if (hit && hit.type === 'duck' && Game.isMyPlot(hit.plotIndex)) {
        this.draggedDuck = {
          duck: hit.duck,
          plotIndex: hit.plotIndex,
          worldX: wPos.x,
          worldY: wPos.y,
          screenX: sx,
          screenY: sy,
          startX: sx,
          startY: sy,
          hasMoved: false,
          overPit: false,
          overBreedZone: false
        };
        return;
      }

      this.camera.isDragging = true;
      this.camera.dragStartX = sx;
      this.camera.dragStartY = sy;
      this.camera.camStartX = this.camera.x;
      this.camera.camStartY = this.camera.y;
      this.camera.movedDist = 0;
    });

    window.addEventListener('mousemove', (e) => {
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const wPos = this.screenToWorld(sx, sy);

      if (this.draggedDuck) {
        const dist = Math.hypot(sx - this.draggedDuck.startX, sy - this.draggedDuck.startY);
        if (dist > 8) this.draggedDuck.hasMoved = true;
        this.draggedDuck.worldX = wPos.x;
        this.draggedDuck.worldY = wPos.y;
        this.draggedDuck.screenX = sx;
        this.draggedDuck.screenY = sy;

        // 檢查是否拖到中央黑洞或底部黑洞傳送門
        const distToCenterPit = Math.hypot(wPos.x, wPos.y);
        const overBottomPortal = (sy > this.height - 155 && Math.abs(sx - this.width / 2) < 220);
        this.draggedDuck.nearPitZone = (distToCenterPit < this.PIT_RADIUS + 40) || overBottomPortal;
        this.draggedDuck.overPit = !this.draggedDuck.duck.locked && this.draggedDuck.nearPitZone;

        // 檢查是否拖進自己領地的「💕 生蛋交配區 (3組交配室)」
        const plotDef = this.plotDefinitions[this.draggedDuck.plotIndex];
        if (plotDef) {
          const rx = wPos.x - plotDef.x;
          const ry = wPos.y - plotDef.y;
          this.draggedDuck.overBreedZone = this.isInsideBreedZone(rx, ry);
          this.draggedDuck.hoverBreedRoomIdx = this.getBreedRoomIndexAt(rx, ry);
        }
        return;
      }

      if (this.camera.isDragging) {
        const dx = sx - this.camera.dragStartX;
        const dy = sy - this.camera.dragStartY;
        this.camera.movedDist = Math.hypot(dx, dy);
        this.camera.x = this.camera.camStartX - dx / this.camera.zoom;
        this.camera.y = this.camera.camStartY - dy / this.camera.zoom;
        return;
      }

      this.hoveredEntity = this.hitTest(wPos.x, wPos.y);
      c.style.cursor = this.hoveredEntity ? 'pointer' : 'grab';
    });

    window.addEventListener('mouseup', (e) => {
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const wPos = this.screenToWorld(sx, sy);

      if (this.draggedDuck) {
        const dd = this.draggedDuck;
        this.draggedDuck = null;

        if (dd.hasMoved) {
          if (dd.overPit) {
            Game.sacrificeDuckToPit(dd.duck.id);
            return;
          }
          if (dd.nearPitZone && dd.duck.locked) {
            Game.notify('🔒 這隻鴨子已鎖定保護！請先點開右側面板解鎖後再丟進黑洞。', 'warn');
            return;
          }

          const plotDef = this.plotDefinitions[dd.plotIndex];
          if (plotDef) {
            const rx = wPos.x - plotDef.x;
            const ry = wPos.y - plotDef.y;
            if (this.isInsideBreedZone(rx, ry)) {
              const targetRoomIdx = this.getBreedRoomIndexAt(rx, ry);
              Game.assignDuckToBreedZone(dd.duck.id, targetRoomIdx >= 0 ? targetRoomIdx : null);
            } else {
              // 移回放牧大草地
              Game.removeDuckFromBreedZone(dd.duck.id, rx, ry);
            }
          }
          return;
        } else {
          Game.onSelectEntity({ type: 'duck', duck: dd.duck, plotIndex: dd.plotIndex });
          return;
        }
      }

      if (this.camera.isDragging) {
        const moved = this.camera.movedDist;
        this.camera.isDragging = false;
        if (moved < 7) {
          const hit = this.hitTest(wPos.x, wPos.y);
          if (hit) {
            Game.onEntityClicked(hit, wPos.x, wPos.y);
          } else {
            Game.closeInspector();
          }
        }
      }
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 0.09 : -0.09;
      this.adjustZoom(zoomFactor);
    }, { passive: false });
  },

  hitTest(wx, wy) {
    // 1. 檢查中央黑洞與 Boss 競技場
    const distPit = Math.hypot(wx, wy);
    if (distPit <= this.PIT_RADIUS) {
      return { type: 'pit', x: 0, y: 0 };
    }

    // 2. 檢查各領地
    const plots = Game.getAllPlots();
    for (let i = 0; i < this.plotDefinitions.length; i++) {
      const def = this.plotDefinitions[i];
      const plotData = plots[i];
      // 第 2、3 號擴充領地若無主人則不顯示也不判定
      if (i >= 2 && (!plotData || !plotData.owner)) continue;
      if (!plotData || !plotData.owner) continue;

      const rx = wx - def.x;
      const ry = wy - def.y;

      if (Math.abs(rx) <= this.PLOT_W / 2 + 25 && Math.abs(ry) <= this.PLOT_H / 2 + 40) {
        // 檢查別人領地招牌上的「🤝相親 / 🔄交換」按鈕
        if (!Game.isMyPlot(i)) {
          if (rx >= 280 && rx <= 510 && ry >= -this.PLOT_H / 2 - 26 && ry <= -this.PLOT_H / 2 + 24) {
            return { type: 'plotAction', plotIndex: i, owner: plotData.owner };
          }
        }

        // 檢查自己領地「💕 生蛋交配區」內的【⚡ 一鍵派滿 3 組公母】按鈕
        if (Game.isMyPlot(i)) {
          const bz = this.BREED_ZONE;
          if (rx >= bz.x + 40 && rx <= bz.x + bz.w - 40 && ry >= bz.y + bz.h - 42 && ry <= bz.y + bz.h - 6) {
            return { type: 'breedNowBtn', plotIndex: i };
          }
        }

        // 檢查孵化鴨窩區裡的鴨蛋
        const eggs = plotData.eggs || [];
        for (let ei = eggs.length - 1; ei >= 0; ei--) {
          const egg = eggs[ei];
          const pos = this.getEggLocalPos(ei);
          if (Math.hypot(rx - pos.x, ry - pos.y) <= 28) {
            return { type: 'egg', egg, plotIndex: i, worldX: def.x + pos.x, worldY: def.y + pos.y };
          }
        }

        // 檢查領地內的鴨子 (包含在 3 間生蛋交配室內的公母鴨)
        const ducks = plotData.ducks || [];
        for (let di = ducks.length - 1; di >= 0; di--) {
          const d = ducks[di];
          const pos = this.getDuckRenderLocalPos(plotData, d);
          if (Math.hypot(rx - pos.x, ry - pos.y) <= (pos.inBreedRoom ? 30 : 38)) {
            return { type: 'duck', duck: d, plotIndex: i, worldX: def.x + pos.x, worldY: def.y + pos.y };
          }
        }

        return { type: 'plot', plotIndex: i, plotData };
      }
    }
    return null;
  },

  getDuckRenderLocalPos(plotData, duck) {
    const rooms = plotData.breedingRooms || [];
    for (let r = 0; r < rooms.length; r++) {
      const rm = rooms[r];
      if (!rm) continue;
      if (rm.maleId === duck.id) {
        const p = this.getBreedRoomSlotPos(r, 'M');
        return { x: p.x, y: p.y, inBreedRoom: true, roomIdx: r };
      }
      if (rm.femaleId === duck.id) {
        const p = this.getBreedRoomSlotPos(r, 'F');
        return { x: p.x, y: p.y, inBreedRoom: true, roomIdx: r };
      }
    }
    return { x: duck.lx || -180, y: duck.ly || 0, inBreedRoom: false };
  },

  getEggLocalPos(index) {
    // 鴨窩位於右下角 NEST_ZONE (4欄 x 5列，可輕鬆容納 20 顆蛋)
    const nz = this.NEST_ZONE;
    const cols = 4;
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      x: nz.x + 56 + col * 76,
      y: nz.y + 78 + row * 68
    };
  },

  spawnFloatingText(wx, wy, text, color = '#facc15', size = 18) {
    this.floatingTexts.push({
      x: wx,
      y: wy,
      text,
      color,
      size,
      alpha: 1,
      vy: -1.4,
      life: 55
    });
  },

  spawnBurstParticles(wx, wy, color = '#facc15', count = 16) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 1.6 + Math.random() * 4.8;
      this.particles.push({
        x: wx,
        y: wy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        r: 3 + Math.random() * 4,
        color,
        alpha: 1,
        life: 28 + Math.random() * 18
      });
    }
  },

  spawnProjectile(startX, startY, targetX, targetY, color = '#fde047') {
    this.projectiles.push({
      sx: startX,
      sy: startY,
      tx: targetX + (Math.random() - 0.5) * 50,
      ty: targetY + (Math.random() - 0.5) * 50,
      progress: 0,
      color
    });
  },

  spawnFlyingSacrificeDuck(duck, startWx, startWy) {
    this.flyingDucks.push({
      duck: JSON.parse(JSON.stringify(duck)),
      startX: startWx,
      startY: startWy,
      x: startWx,
      y: startWy,
      progress: 0,
      rot: 0
    });
  },

  loop(ts) {
    this.update(ts);
    this.render(ts);
    requestAnimationFrame((nextTs) => this.loop(nextTs));
  },

  update(ts) {
    if (typeof Game === 'undefined' || !Game.ready) return;
    const dt = this._lastTs ? Math.min(0.05, Math.max(0.001, (ts - this._lastTs) / 1000)) : (1 / 60);
    this._lastTs = ts;
    const step = dt * 60;

    const pb = this.PASTURE_BOUNDS;
    const plots = Game.getAllPlots();
    plots.forEach((p) => {
      if (!p || !p.ducks) return;
      p.ducks.forEach((d, di) => {
        if (d.lx === undefined) {
          const cols = 6;
          d.lx = pb.minX + 60 + (di % cols) * 95 + (Math.random() * 20 - 10);
          d.ly = pb.minY + 60 + Math.floor(di / cols) * 95 + (Math.random() * 20 - 10);
          d.tx = d.lx;
          d.ty = d.ly;
          d.facing = 1;
          d.walkPhase = Math.random() * 10;
        }

        // 若在 3 間生蛋交配室之內，面向彼此並原地搖擺
        const rooms = p.breedingRooms || [];
        const inMaleSlot = rooms.some(rm => rm && rm.maleId === d.id);
        const inFemaleSlot = rooms.some(rm => rm && rm.femaleId === d.id);
        if (inMaleSlot) {
          d.facing = 1;
          d.walkPhase = (d.walkPhase || 0) + 0.14 * step;
          return;
        }
        if (inFemaleSlot) {
          d.facing = -1;
          d.walkPhase = (d.walkPhase || 0) + 0.14 * step;
          return;
        }

        if (this.draggedDuck && this.draggedDuck.duck.id === d.id) return;

        const dist = Math.hypot((d.tx || 0) - d.lx, (d.ty || 0) - d.ly);
        if (dist < 6) {
          if (Math.random() < 0.02 * step) {
            d.tx = pb.minX + 40 + Math.random() * (pb.maxX - pb.minX - 80);
            d.ty = pb.minY + 40 + Math.random() * (pb.maxY - pb.minY - 80);
          }
        } else {
          const spd = 0.9 * step;
          const dx = d.tx - d.lx;
          const dy = d.ty - d.ly;
          d.facing = dx >= 0 ? 1 : -1;
          d.lx += (dx / dist) * spd;
          d.ly += (dy / dist) * spd;
          d.walkPhase = (d.walkPhase || 0) + 0.18 * step;
        }
      });
    });

    // 更新飛彈光束
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pj = this.projectiles[i];
      pj.progress += 0.12 * step;
      if (pj.progress >= 1) {
        this.spawnBurstParticles(pj.tx, pj.ty, pj.color, 6);
        this.projectiles.splice(i, 1);
      }
    }

    // 更新飛向黑洞的獻祭鴨
    for (let i = this.flyingDucks.length - 1; i >= 0; i--) {
      const fd = this.flyingDucks[i];
      fd.progress += 0.035 * step;
      const t = fd.progress;
      fd.x = fd.startX * (1 - t);
      fd.y = fd.startY * (1 - t) - Math.sin(t * Math.PI) * 190;
      fd.rot += 0.28 * step;
      if (fd.progress >= 1) {
        this.spawnBurstParticles(0, 0, '#f43f5e', 20);
        this.spawnFloatingText(0, -30, '🕳️ 呱啊啊～！！', '#fb7185', 20);
        this.flyingDucks.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.x += pt.vx * step;
      pt.y += pt.vy * step;
      pt.life -= step;
      pt.alpha = Math.max(0, pt.life / 35);
      if (pt.life <= 0) this.particles.splice(i, 1);
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy * step;
      ft.life -= step;
      ft.alpha = Math.max(0, ft.life / 40);
      if (ft.life <= 0) this.floatingTexts.splice(i, 1);
    }
  },

  render(ts) {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.fillStyle = '#365314';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    this.drawWorldGround(ctx, ts);
    this.drawCentralPitAndBossArena(ctx, ts);
    this.drawAllPlots(ctx, ts);

    // 繪製戰鴨攻擊 Boss 的飛彈（使用輕量光暈圓取代高耗能 shadowBlur）
    this.projectiles.forEach(pj => {
      const x = pj.sx + (pj.tx - pj.sx) * pj.progress;
      const y = pj.sy + (pj.ty - pj.sy) * pj.progress;
      ctx.save();
      ctx.fillStyle = pj.color;
      ctx.globalAlpha = 0.28;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    this.flyingDucks.forEach(fd => {
      ctx.save();
      ctx.translate(fd.x, fd.y);
      ctx.rotate(fd.rot);
      const scale = Math.max(0.2, 1 - fd.progress * 0.75);
      ctx.scale(scale, scale);
      this.drawCustomDuck(ctx, fd.duck, 0, 0, ts, false);
      ctx.restore();
    });

    this.particles.forEach(pt => {
      ctx.save();
      ctx.globalAlpha = pt.alpha;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    this.floatingTexts.forEach(ft => {
      ctx.save();
      ctx.globalAlpha = ft.alpha;
      ctx.font = `bold ${ft.size}px "Microsoft JhengHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 4;
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    });

    if (this.draggedDuck) {
      ctx.save();
      ctx.translate(this.draggedDuck.worldX, this.draggedDuck.worldY);
      ctx.scale(1.22, 1.22);
      this.drawCustomDuck(ctx, this.draggedDuck.duck, 0, 0, ts, true);
      const gTag = this.draggedDuck.duck.gender === 'M' ? '♂公鴨' : '♀母鴨';
      const roomLabel = (this.draggedDuck.hoverBreedRoomIdx >= 0) ? `【交配室 #${this.draggedDuck.hoverBreedRoomIdx + 1}】` : '【生蛋交配區】';
      ctx.fillStyle = this.draggedDuck.overBreedZone ? '#f472b6' : '#fef08a';
      ctx.font = 'bold 14px "Microsoft JhengHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        this.draggedDuck.overBreedZone
          ? `💕 放開滑鼠！讓【${gTag}】進入${roomLabel}！`
          : `🦆 拖至右上【💕生蛋交配室 #1~#3】產卵，或拖至下方【🕳️黑洞】獻祭`,
        0, -58
      );
      ctx.restore();
    }

    ctx.restore();

    if (this.draggedDuck) {
      this.drawBottomPitDropZone(ctx, ts);
    }

    this.drawMinimap(ctx);
  },

  drawWorldGround(ctx, ts) {
    const halfW = (this.width / 2) / this.camera.zoom + 220;
    const halfH = (this.height / 2) / this.camera.zoom + 220;
    const minX = this.camera.x - halfW;
    const maxX = this.camera.x + halfW;
    const minY = this.camera.y - halfH;
    const maxY = this.camera.y + halfH;

    const gridSize = 180;
    const startGx = Math.max(-2200, Math.floor(minX / gridSize) * gridSize);
    const endGx = Math.min(2200, Math.ceil(maxX / gridSize) * gridSize);
    const startGy = Math.max(-1400, Math.floor(minY / gridSize) * gridSize);
    const endGy = Math.min(1400, Math.ceil(maxY / gridSize) * gridSize);

    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let gx = startGx; gx <= endGx; gx += gridSize) {
      for (let gy = startGy; gy <= endGy; gy += gridSize) {
        if ((Math.abs(gx / gridSize) + Math.abs(gy / gridSize)) % 2 === 0) {
          ctx.fillRect(gx, gy, gridSize, gridSize);
        }
      }
    }

    // 連接中央黑洞競技場與左右兩大巨型領地的寬闊石板大道
    ctx.strokeStyle = 'rgba(214, 211, 209, 0.28)';
    ctx.lineWidth = 48;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-960, 0);
    ctx.lineTo(960, 0);
    ctx.stroke();

    this.decorations.forEach(d => {
      if (d.x < minX || d.x > maxX || d.y < minY || d.y > maxY) return;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.scale(d.scale, d.scale);
      if (d.type === 'grass') {
        ctx.strokeStyle = '#65a30d';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-4, 0); ctx.lineTo(-7, -10);
        ctx.moveTo(0, 0); ctx.lineTo(0, -13);
        ctx.moveTo(4, 0); ctx.lineTo(7, -9);
        ctx.stroke();
      } else if (d.type === 'flower') {
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(0, -4, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(0, -4, 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#78716c';
        ctx.beginPath();
        ctx.ellipse(0, 0, 8, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  },

  drawCentralPitAndBossArena(ctx, ts) {
    const pit = (typeof Game !== 'undefined' && Game.world) ? Game.world.pit : { progress: 25, maxProgress: 100 };
    const raid = (typeof Game !== 'undefined' && Game.world && Game.world.bossRaid) ? Game.world.bossRaid : { active: false };
    const pulse = Math.sin(ts * 0.004) * 8;

    ctx.save();
    const outerGrad = ctx.createRadialGradient(0, 0, 45, 0, 0, this.PIT_RADIUS + 40);
    outerGrad.addColorStop(0, '#09040e');
    outerGrad.addColorStop(0.65, '#1e1b4b');
    outerGrad.addColorStop(0.88, raid.active ? '#be123c' : '#4c1d95');
    outerGrad.addColorStop(1, 'rgba(76, 29, 149, 0)');
    ctx.fillStyle = outerGrad;
    ctx.beginPath();
    ctx.arc(0, 0, this.PIT_RADIUS + 40 + pulse, 0, Math.PI * 2);
    ctx.fill();

    for (let r = 3; r >= 1; r--) {
      ctx.save();
      ctx.rotate((ts * 0.0012 * (4 - r)) * (r % 2 === 0 ? 1 : -1));
      ctx.strokeStyle = r === 1 ? '#f43f5e' : (r === 2 ? '#a855f7' : '#6366f1');
      ctx.lineWidth = 4.5;
      ctx.setLineDash([22, 16]);
      ctx.beginPath();
      ctx.arc(0, 0, r * 58, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = '#030106';
    ctx.beginPath();
    ctx.arc(0, 0, 115, 0, Math.PI * 2);
    ctx.fill();

    // 若組隊 Boss 共鬥進行中！
    if (raid && raid.active) {
      const bossTier = BOSS_TIERS.find(b => b.id === raid.bossTierId) || BOSS_TIERS[0];
      const bossShake = Math.sin(ts * 0.028) * 5;

      // 1. 繪製參戰玩家們派出的「出戰怪鴨小隊」環繞在黑洞外圍集火攻擊！
      const members = Object.values(raid.participants || {});
      let allSquadDucks = [];
      members.forEach(m => {
        (m.squad || []).forEach(sd => {
          allSquadDucks.push({ ...sd, ownerName: m.username });
        });
      });

      allSquadDucks.forEach((sd, idx) => {
        const ang = (idx / Math.max(1, allSquadDucks.length)) * Math.PI * 2 + ts * 0.0005;
        const radius = this.PIT_RADIUS + 38;
        const dx = Math.cos(ang) * radius;
        const dy = Math.sin(ang) * radius;
        sd.facing = dx < 0 ? 1 : -1;
        sd.walkPhase = ts * 0.01 + idx;
        this.drawCustomDuck(ctx, sd, dx, dy, ts, false);
      });

      // 2. 繪製中央深淵巨怪 Boss 本體
      ctx.save();
      ctx.translate(bossShake, Math.cos(ts * 0.006) * 7);

      for (let t = 0; t < 10; t++) {
        const ang = (t / 10) * Math.PI * 2 + Math.sin(ts * 0.004 + t) * 0.25;
        ctx.save();
        ctx.rotate(ang);
        ctx.fillStyle = '#881337';
        ctx.strokeStyle = bossTier.color;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(-16, 45);
        ctx.quadraticCurveTo(-32, 125, Math.sin(ts * 0.008 + t) * 30, 195);
        ctx.quadraticCurveTo(32, 125, 16, 45);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      ctx.fillStyle = '#4c0519';
      ctx.strokeStyle = bossTier.color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, -10, 82, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const eyePositions = [
        { x: 0, y: -32, r: 21 },
        { x: -38, y: -14, r: 14 },
        { x: 38, y: -14, r: 14 },
        { x: -22, y: -56, r: 11 },
        { x: 22, y: -56, r: 11 }
      ];
      eyePositions.forEach(ep => {
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(ep.x, ep.y, ep.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#dc2626';
        ctx.beginPath();
        ctx.arc(ep.x + Math.sin(ts * 0.005) * 4, ep.y, ep.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.fillStyle = '#09040e';
      ctx.beginPath();
      ctx.arc(0, 22, 34, 0, Math.PI);
      ctx.fill();
      ctx.restore();

      // Boss 血條、稀有度護甲減傷與限時倒數
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.fillRect(-190, -198, 380, 34);
      const hpPct = Math.max(0, Math.min(1, raid.bossHp / raid.bossMaxHp));
      ctx.fillStyle = bossTier.color;
      ctx.fillRect(-186, -194, 372 * hpPct, 26);
      ctx.strokeStyle = '#fda4af';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(-190, -198, 380, 34);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px "Microsoft JhengHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${bossTier.name} HP: ${Math.ceil(raid.bossHp).toLocaleString()} / ${raid.bossMaxHp.toLocaleString()}`, 0, -176);

      const remSec = raid.startedAt
        ? Math.max(0, (raid.durationSec || 90) - Math.floor((Date.now() - raid.startedAt) / 1000))
        : (raid.remainingSec !== undefined ? raid.remainingSec : 90);
      const armorPct = Math.round((bossTier.armorReduction || 0) * 100);
      ctx.fillStyle = '#fde047';
      ctx.font = 'bold 15px "Microsoft JhengHei", sans-serif';
      ctx.fillText(`⚔️ 3+3 聯合小隊自動圍攻中｜🛡️Boss護甲減傷 ${armorPct}%｜⏱️剩餘 ${remSec} 秒`, 0, -214);
    } else {
      const sac = (pit && pit.sacrifices) ? pit.sacrifices : { total: 0, rarePlus: 0, epicPlus: 0, legendaryOrSet: 0, cursedOrHighSet: 0 };

      ctx.fillStyle = '#e9d5ff';
      ctx.font = 'bold 19px "Microsoft JhengHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🕳️ 中央深淵祭壇 (每階滿 30 隻對應品質鴨即可召喚 Boss)', 0, -162);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 2;
      roundRect(ctx, -238, -148, 476, 34, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11.5px "Microsoft JhengHei", sans-serif';
      ctx.fillText(
        `🦆普:${sac.total || 0}/30 ｜ 💠藍+:${sac.rarePlus || 0}/30 ｜ 🔮紫+:${sac.epicPlus || 0}/30 ｜ 👑金/套:${sac.legendaryOrSet || 0}/30 ｜ 🩸紅/高套:${sac.cursedOrHighSet || 0}/30`,
        0, -127
      );

      ctx.fillStyle = '#fde047';
      ctx.font = 'bold 14px "Microsoft JhengHei", sans-serif';
      ctx.fillText('⚔️ 湊滿 30 隻祭品後，點擊此處手動召集組隊討伐（Boss 越稀有越強）！', 0, 155);
    }

    ctx.restore();
  },

  drawAllPlots(ctx, ts) {
    if (typeof Game === 'undefined' || !Game.ready) return;
    const plots = Game.getAllPlots();

    this.plotDefinitions.forEach((def, idx) => {
      const plotData = plots[idx];
      const hasOwner = plotData && plotData.owner;
      // 只顯示前 2 個主領地（雙人遊玩專用）；若第 3、4 領地有真實玩家登入才顯示
      if (idx >= 2 && !hasOwner) return;

      const isMine = Game.isMyPlot(idx);
      const isOnline = hasOwner && Game.isPlayerOnline(plotData.owner);

      ctx.save();
      ctx.translate(def.x, def.y);

      const hw = this.PLOT_W / 2;
      const hh = this.PLOT_H / 2;

      // 1. 巨型領地草皮底板 (1120 x 820)
      ctx.fillStyle = hasOwner ? (isMine ? '#3f6212' : '#365314') : 'rgba(15, 23, 42, 0.55)';
      ctx.strokeStyle = isMine ? '#facc15' : (hasOwner ? (isOnline ? '#38bdf8' : '#a16207') : '#64748b');
      ctx.lineWidth = isMine ? 8 : 5;

      roundRect(ctx, -hw, -hh, this.PLOT_W, this.PLOT_H, 28);
      ctx.fill();
      ctx.stroke();

      if (!hasOwner) {
        ctx.fillStyle = 'rgba(226, 232, 240, 0.65)';
        ctx.font = 'bold 26px "Microsoft JhengHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`🪧 雙人連線專屬巨型牧場領地 #${idx + 1}`, 0, -16);
        ctx.font = '18px "Microsoft JhengHei", sans-serif';
        ctx.fillStyle = '#fde047';
        ctx.fillText('（等待第 2 位玩家連線創建帳號入駐）', 0, 24);
        ctx.restore();
        return;
      }

      // 2. 左下角清涼大戲水池
      ctx.fillStyle = '#0284c7';
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(-310, 220, 145, 85, -0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = 'bold 14px "Microsoft JhengHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('💧 怪鴨戲水池', -310, 225);

      // 3. 右上角專屬分區：【💕 生蛋交配區 (Breeding Love Pen)】
      this.drawBreedingZone(ctx, plotData, isMine, ts);

      // 4. 右下角專屬分區：【🪺 巨型孵化鴨窩區 (Giant Hatchery Nest)】
      this.drawHatcheryZone(ctx, plotData, isMine, ts);

      // 5. 領地頂部巨型招牌與總戰力顯示
      const totalPower = Game.getPlotTotalPower(plotData);
      ctx.fillStyle = isMine ? '#0f172a' : 'rgba(15, 23, 42, 0.9)';
      ctx.strokeStyle = isMine ? '#facc15' : (isOnline ? '#38bdf8' : '#94a3b8');
      ctx.lineWidth = 3;
      roundRect(ctx, -520, -hh - 28, 1040, 52, 14);
      ctx.fill();
      ctx.stroke();

      const statusBadge = isMine ? '🏠 我的巨型鴨場' : (isOnline ? '🟢 連線在線玩家' : '⚪ 離線保留領地');
      ctx.fillStyle = isMine ? '#fde047' : '#f8fafc';
      ctx.font = 'bold 18px "Microsoft JhengHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(
        `${statusBadge}｜【${plotData.owner}】的領地 (🦆鴨群 ${(plotData.ducks || []).length}/${plotData.maxDucks || 24} ｜ 🪺鴨窩 ${(plotData.eggs || []).length}/${plotData.maxEggs || 12} ｜ ⚔️總戰力 ${totalPower.toLocaleString()})`,
        -495, -hh + 4
      );

      if (!isMine) {
        ctx.fillStyle = '#ec4899';
        roundRect(ctx, 285, -hh - 19, 215, 34, 9);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 15px "Microsoft JhengHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🤝 跨場相親 / 點對點交換', 392, -hh + 3);
      }

      // 6. 繪製領地內的所有怪鴨（放牧區與 3 間生蛋交配室）
      const ducks = plotData.ducks || [];
      ducks.forEach(duck => {
        if (this.draggedDuck && this.draggedDuck.duck.id === duck.id) return;
        const pos = this.getDuckRenderLocalPos(plotData, duck);
        const isSelected = this.selectedEntity && this.selectedEntity.type === 'duck' && this.selectedEntity.duck.id === duck.id;
        if (pos.inBreedRoom) {
          ctx.save();
          ctx.translate(pos.x, pos.y);
          ctx.scale(0.76, 0.76);
          this.drawCustomDuck(ctx, duck, 0, 0, ts, isSelected);
          ctx.restore();
        } else {
          this.drawCustomDuck(ctx, duck, pos.x, pos.y, ts, isSelected);
        }
      });

      ctx.restore();
    });
  },

  // 繪製右上角【💕 生蛋交配區 (支援 3 組公母同時產卵，產卵時間 60 秒，3% 變異蛋機率)】
  drawBreedingZone(ctx, plotData, isMine, ts) {
    const bz = this.BREED_ZONE;
    const isHighlight = isMine && this.draggedDuck && this.draggedDuck.overBreedZone;

    ctx.save();
    ctx.fillStyle = isHighlight ? 'rgba(236, 72, 153, 0.28)' : 'rgba(131, 24, 67, 0.42)';
    ctx.strokeStyle = isHighlight ? '#fde047' : '#f472b6';
    ctx.lineWidth = isHighlight ? 5 : 3;
    roundRect(ctx, bz.x, bz.y, bz.w, bz.h, 20);
    ctx.fill();
    ctx.stroke();

    // 標題與 97%雙親遺傳 / 3%變異蛋說明
    ctx.fillStyle = '#fbcfe8';
    ctx.font = 'bold 15px "Microsoft JhengHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('💕 生蛋交配區 (3 組公母交配室｜產卵週期 60 秒)', bz.x + bz.w / 2, bz.y + 23);
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 11.5px "Microsoft JhengHei", sans-serif';
    ctx.fillText('✨ 97% 雙親外觀遺傳 (1分孵化) ｜ 3% 基因變異蛋 (3分孵化)', bz.x + bz.w / 2, bz.y + 41);

    const rooms = plotData.breedingRooms || [
      { maleId: null, femaleId: null, elapsedSec: 0 },
      { maleId: null, femaleId: null, elapsedSec: 0 },
      { maleId: null, femaleId: null, elapsedSec: 0 }
    ];
    const ducks = plotData.ducks || [];

    let activeRoomCount = 0;

    for (let r = 0; r < 3; r++) {
      const rm = rooms[r] || { maleId: null, femaleId: null, elapsedSec: 0 };
      const roomTop = bz.y + 50 + r * 86;
      const roomH = 80;
      const isRoomHover = isHighlight && this.draggedDuck.hoverBreedRoomIdx === r;

      ctx.fillStyle = isRoomHover ? 'rgba(244, 114, 182, 0.28)' : 'rgba(15, 23, 42, 0.55)';
      ctx.strokeStyle = isRoomHover ? '#fde047' : 'rgba(244, 114, 182, 0.45)';
      ctx.lineWidth = isRoomHover ? 2.5 : 1.5;
      roundRect(ctx, bz.x + 12, roomTop, bz.w - 24, roomH, 12);
      ctx.fill();
      ctx.stroke();

      const mPos = this.getBreedRoomSlotPos(r, 'M');
      const fPos = this.getBreedRoomSlotPos(r, 'F');
      const hasMale = rm.maleId && ducks.some(d => d.id === rm.maleId);
      const hasFemale = rm.femaleId && ducks.some(d => d.id === rm.femaleId);
      if (hasMale && hasFemale) activeRoomCount++;

      // 左槽：♂ 公鴨位
      ctx.fillStyle = 'rgba(2, 132, 199, 0.26)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.arc(mPos.x, mPos.y, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      if (!hasMale) {
        ctx.fillStyle = '#7dd3fc';
        ctx.font = 'bold 11px "Microsoft JhengHei", sans-serif';
        ctx.fillText(`♂公鴨#${r + 1}`, mPos.x, mPos.y + 4);
      }

      // 右槽：♀ 母鴨位
      ctx.fillStyle = 'rgba(225, 29, 72, 0.26)';
      ctx.strokeStyle = '#fb7185';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.arc(fPos.x, fPos.y, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      if (!hasFemale) {
        ctx.fillStyle = '#fda4af';
        ctx.font = 'bold 11px "Microsoft JhengHei", sans-serif';
        ctx.fillText(`♀母鴨#${r + 1}`, fPos.x, fPos.y + 4);
      }

      // 中央狀態與 60 秒產卵進度條
      const midX = bz.x + bz.w / 2;
      ctx.fillStyle = '#fbcfe8';
      ctx.font = 'bold 12px "Microsoft JhengHei", sans-serif';
      ctx.fillText(`${hasMale && hasFemale ? '💖' : '🤍'} 交配室 #${r + 1}`, midX, roomTop + 24);

      const elapsed = (typeof Game !== 'undefined' && Game.getEffectiveBreedElapsedSec && plotData)
        ? Game.getEffectiveBreedElapsedSec(plotData, rm)
        : (rm.elapsedSec || 0);
      const totalSec = (typeof Game !== 'undefined' && Game.getPlotBreedTimeSec && plotData)
        ? Game.getPlotBreedTimeSec(plotData)
        : (typeof BREED_TIME_SEC !== 'undefined' ? BREED_TIME_SEC : 60);
      const pct = Math.min(1, elapsed / totalSec);
      const remSec = Math.max(0, totalSec - elapsed);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(midX - 58, roomTop + 34, 116, 14);
      ctx.fillStyle = (hasMale && hasFemale) ? '#ec4899' : '#475569';
      ctx.fillRect(midX - 56, roomTop + 36, 112 * pct, 10);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10.5px "Microsoft JhengHei", sans-serif';
      ctx.fillText(
        (hasMale && hasFemale) ? `🥚 產卵倒數 ${remSec}s` : '拖入 1♂ + 1♀',
        midX,
        roomTop + 64
      );
    }

    // 底部【💕 一鍵派滿 3 組公母鴨入座交配】快捷按鈕
    if (isMine) {
      ctx.fillStyle = activeRoomCount >= 3 ? '#334155' : '#ec4899';
      roundRect(ctx, bz.x + 40, bz.y + bz.h - 40, bz.w - 80, 30, 8);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12.5px "Microsoft JhengHei", sans-serif';
      ctx.fillText(
        activeRoomCount >= 3
          ? `💕 3 組交配室全數運作中 (${activeRoomCount}/3 組)`
          : `💕 點擊一鍵派滿 3 組公母鴨入座交配 (目前 ${activeRoomCount}/3 組)`,
        bz.x + bz.w / 2,
        bz.y + bz.h - 20
      );
    }

    ctx.restore();
  },

  // 繪製右下角【🪺 巨型孵化鴨窩區】
  drawHatcheryZone(ctx, plotData, isMine, ts) {
    const nz = this.NEST_ZONE;
    ctx.save();
    ctx.fillStyle = 'rgba(161, 98, 7, 0.45)';
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 3;
    roundRect(ctx, nz.x, nz.y, nz.w, nz.h, 20);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fef08a';
    ctx.font = 'bold 15px "Microsoft JhengHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `🪺 孵化鴨窩區 (${(plotData.eggs || []).length}/${plotData.maxEggs || 12})｜一般蛋1分 / 🧬變異蛋3分 (時間到點擊孵化)`,
      nz.x + nz.w / 2,
      nz.y + 28
    );

    const eggs = plotData.eggs || [];
    eggs.forEach((egg, ei) => {
      const pos = this.getEggLocalPos(ei);
      this.drawEggInNest(ctx, egg, pos.x, pos.y, isMine, ts, plotData);
    });

    ctx.restore();
  },

  drawEggInNest(ctx, egg, x, y, isMine, ts, plotData) {
    const rObj = RARITIES[egg.rarity] || RARITIES.common;
    const wobble = Math.sin(ts * 0.008 + x) * 0.08;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(wobble);

    if (egg.isMutated || egg.rarity !== 'common') {
      ctx.fillStyle = rObj.bg;
      ctx.beginPath();
      ctx.arc(0, 0, 27, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = rObj.eggColor;
    ctx.strokeStyle = egg.isMutated ? '#c084fc' : rObj.border;
    ctx.lineWidth = egg.isMutated ? 3 : 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 23, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = rObj.eggSpot;
    ctx.beginPath();
    ctx.arc(-6, -6, 4, 0, Math.PI * 2);
    ctx.arc(7, 3, 5, 0, Math.PI * 2);
    ctx.arc(-3, 9, 3, 0, Math.PI * 2);
    ctx.fill();

    // 變異蛋專屬標記
    if (egg.isMutated) {
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🧬', 0, -8);
    }

    if (egg.graffiti && egg.graffiti.length > 0) {
      const lastG = egg.graffiti[egg.graffiti.length - 1];
      ctx.font = '15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(lastG.icon || '🥸', 0, 8);
    }

    ctx.restore();

    // 孵化倒計時進度條與 MM:SS 顯示（離線玩家倒計時歸零後停止不孵出，上線後才自動破殼）
    const totalSec = egg.totalSec || (egg.isMutated ? HATCH_TIME_MUTATED_SEC : HATCH_TIME_NORMAL_SEC);
    const remSec = (typeof Game !== 'undefined' && Game.getEffectiveEggRemainingSec && plotData)
      ? Game.getEffectiveEggRemainingSec(plotData, egg)
      : Math.max(0, egg.remainingSec !== undefined ? egg.remainingSec : totalSec);
    const ownerOnline = (typeof Game !== 'undefined' && plotData && plotData.owner)
      ? Game.isPlayerOnline(plotData.owner)
      : isMine;
    const pct = Math.min(1, Math.max(0, (totalSec - remSec) / totalSec));

    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(x - 22, y + 23, 44, 6);
    ctx.fillStyle = remSec <= 0 ? '#22c55e' : (egg.isMutated ? '#c084fc' : '#fde047');
    ctx.fillRect(x - 21, y + 24, 42 * pct, 4);

    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 3;
    const timeStr = remSec <= 0
      ? '🥚待孵化'
      : `${egg.isMutated ? '🧬' : '⏱️'}${formatDurationMMSS(remSec)}`;
    ctx.strokeText(timeStr, x, y + 40);
    ctx.fillStyle = remSec <= 0 ? '#4ade80' : (egg.isMutated ? '#e9d5ff' : '#fef08a');
    ctx.fillText(timeStr, x, y + 40);
  },

  // 繪製怪鴨（含 ♂/♀ 性別標籤 與 ⚔️戰力值）
  drawCustomDuck(ctx, duck, x, y, ts, isHighlighted = false) {
    const info = evaluateDuckInfo(duck);
    const bounce = Math.abs(Math.sin((duck.walkPhase || 0) + ts * 0.004)) * 3.5;
    const facing = duck.facing || 1;

    ctx.save();
    ctx.translate(x, y - bounce);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 26 + bounce, 22, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    if (info.isFullSet || info.rarityKey === 'legendary' || info.rarityKey === 'cursed') {
      ctx.save();
      ctx.strokeStyle = info.rarity.color;
      ctx.lineWidth = info.isFullSet ? 3.5 : 2;
      ctx.setLineDash([6, 4]);
      ctx.rotate(ts * 0.002);
      ctx.beginPath();
      ctx.arc(0, 0, 35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (isHighlighted) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 39, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.save();
    ctx.scale(facing, 1);

    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.ellipse(-8, 22, 7, 3.5, 0, 0, Math.PI * 2);
    ctx.ellipse(8, 22, 7, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    this.drawPartBody(ctx, duck.body, ts);
    this.drawPartHead(ctx, duck.head, ts);
    this.drawPartWing(ctx, duck.wing, ts);

    ctx.restore();

    // 頭頂：性別符號 (♂藍 / ♀粉) + 名字 + 戰力值
    const isMale = duck.gender !== 'F';
    const genderSymbol = isMale ? '♂' : '♀';
    const label = `${duck.locked ? '🔒' : ''}${info.isFullSet ? '👑' : ''}${genderSymbol}${duck.name || '小怪鴨'}`;

    ctx.font = 'bold 12px "Microsoft JhengHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 3.5;
    ctx.strokeText(label, 0, -42);
    ctx.fillStyle = isMale ? '#7dd3fc' : '#f9a8d4';
    ctx.fillText(label, 0, -42);

    // 戰力小標籤
    const pwrText = `⚔️${info.combatPower}`;
    ctx.font = 'bold 10px sans-serif';
    ctx.strokeText(pwrText, 0, -29);
    ctx.fillStyle = info.rarity.color;
    ctx.fillText(pwrText, 0, -29);

    ctx.restore();
  },

  drawPartBody(ctx, bodyId, ts) {
    ctx.save();
    switch (bodyId) {
      case 'b_sprout':
        ctx.fillStyle = '#b45309';
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-20, -2); ctx.lineTo(20, -2);
        ctx.lineTo(15, 22); ctx.lineTo(-15, 22);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#92400e';
        ctx.fillRect(-22, -6, 44, 6);
        break;
      case 'b_breakfast':
        ctx.fillStyle = '#fde68a';
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 4;
        roundRect(ctx, -20, -4, 40, 26, 6);
        ctx.fill(); ctx.stroke();
        break;
      case 'b_barber':
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;
        roundRect(ctx, -16, -4, 32, 26, 8);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(-14, 0, 28, 5);
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(-14, 10, 28, 5);
        break;
      case 'b_muscle':
        ctx.fillStyle = '#d97706';
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 2;
        roundRect(ctx, -21, -5, 42, 27, 10);
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#92400e';
        ctx.beginPath();
        ctx.moveTo(0, -2); ctx.lineTo(0, 20);
        ctx.moveTo(-12, 5); ctx.lineTo(12, 5);
        ctx.moveTo(-12, 12); ctx.lineTo(12, 12);
        ctx.stroke();
        break;
      case 'b_knight':
        ctx.fillStyle = '#94a3b8';
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(0, 8, 23, 15, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#eab308';
        ctx.fillRect(-5, 0, 10, 16);
        break;
      case 'b_ninja':
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 8, 21, 14, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(-20, 6, 40, 4);
        break;
      case 'b_wizard':
        ctx.fillStyle = 'rgba(168, 85, 247, 0.78)';
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 9, 17, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#f0abfc';
        ctx.beginPath();
        ctx.arc(-5, 8, 3, 0, Math.PI * 2);
        ctx.arc(6, 12, 4, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'b_cyber':
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(0, 10, 25, 12, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#22d3ee';
        ctx.fillRect(-14, 9, 28, 3);
        break;
      case 'b_retro':
        ctx.fillStyle = '#dc2626';
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 2;
        roundRect(ctx, -19, -4, 38, 26, 5);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-8, 4, 16, 12);
        break;
      case 'b_king':
        ctx.fillStyle = '#facc15';
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 2.5;
        roundRect(ctx, -22, -3, 44, 25, 9);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(0, 9, 5, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'b_angel':
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(-10, 10, 12, 0, Math.PI * 2);
        ctx.arc(10, 10, 12, 0, Math.PI * 2);
        ctx.arc(0, 6, 15, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        break;
      case 'b_dragon':
        ctx.fillStyle = '#991b1b';
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(0, 8, 22, 15, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        break;
      case 'b_cthulhu':
        ctx.fillStyle = '#3b0764';
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 8, 22, 14, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.arc(i * 8, 20, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'b_void':
        ctx.fillStyle = '#09040e';
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 8, 18, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        break;
      default:
        ctx.fillStyle = '#fde047';
        ctx.strokeStyle = '#ca8a04';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 8, 22, 15, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        break;
    }
    ctx.restore();
  },

  drawPartHead(ctx, headId, ts) {
    ctx.save();
    const neckOffset = headId === 'h_void' ? -14 : 0;
    if (headId === 'h_void') {
      ctx.fillStyle = '#1e1b4b';
      ctx.fillRect(-5, -24, 10, 22);
    }

    ctx.translate(4, -12 + neckOffset);

    let headColor = '#fde047';
    if (headId === 'h_muscle') headColor = '#f59e0b';
    if (headId === 'h_ninja') headColor = '#1e293b';
    if (headId === 'h_cyber') headColor = '#cbd5e1';
    if (headId === 'h_dragon') headColor = '#dc2626';
    if (headId === 'h_cthulhu') headColor = '#581c87';
    if (headId === 'h_void') headColor = '#0f172a';

    if (headId === 'h_retro') {
      ctx.fillStyle = '#475569';
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      roundRect(ctx, -15, -14, 30, 24, 4);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(-11, -10, 22, 16);
    } else {
      ctx.fillStyle = headColor;
      ctx.strokeStyle = '#422006';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }

    if (headId === 'h_cthulhu') {
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(10, 2 + i * 3);
        ctx.quadraticCurveTo(20, 4 + i * 4, 16, 12 + i * 2);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#f97316';
      ctx.strokeStyle = '#9a3412';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(14, 2, 7, 4, 0.1, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }

    if (headId === 'h_cyber') {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(2, -5, 11, 5);
    } else if (headId === 'h_void') {
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(4, -3, 3.5, 0, Math.PI * 2);
      ctx.arc(-3, -7, 2.5, 0, Math.PI * 2);
      ctx.arc(5, 4, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(5, -3, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(6, -4, 1, 0, Math.PI * 2);
      ctx.fill();
    }

    switch (headId) {
      case 'h_classic':
        ctx.strokeStyle = '#ca8a04';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, -13);
        ctx.quadraticCurveTo(-5, -23, 4, -22);
        ctx.stroke();
        break;
      case 'h_sprout':
        ctx.strokeStyle = '#16a34a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, -13); ctx.lineTo(0, -24);
        ctx.stroke();
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.ellipse(-5, -24, 5, 3, -0.4, 0, Math.PI * 2);
        ctx.ellipse(5, -24, 5, 3, 0.4, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'h_breakfast':
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(0, -13, 12, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(0, -15, 5, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'h_barber':
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.moveTo(-12, -8);
        ctx.lineTo(22, -18);
        ctx.lineTo(10, -6);
        ctx.closePath();
        ctx.fill();
        break;
      case 'h_muscle':
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(-13, -9, 26, 5);
        break;
      case 'h_knight':
        ctx.fillStyle = '#e2e8f0';
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.5;
        ctx.fillRect(-2, -30, 5, 18);
        ctx.strokeRect(-2, -30, 5, 18);
        ctx.fillStyle = '#eab308';
        ctx.fillRect(-8, -22, 17, 4);
        break;
      case 'h_wizard':
        ctx.fillStyle = '#6b21a8';
        ctx.beginPath();
        ctx.moveTo(-16, -10);
        ctx.lineTo(16, -10);
        ctx.lineTo(0, -34);
        ctx.closePath();
        ctx.fill();
        break;
      case 'h_king':
        ctx.fillStyle = '#facc15';
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-10, -11);
        ctx.lineTo(-10, -24);
        ctx.lineTo(-4, -17);
        ctx.lineTo(0, -25);
        ctx.lineTo(4, -17);
        ctx.lineTo(10, -24);
        ctx.lineTo(10, -11);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        break;
      case 'h_angel':
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, -22, 12, 4, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'h_dragon':
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.moveTo(-4, -12); ctx.lineTo(-12, -26); ctx.lineTo(2, -14);
        ctx.fill();
        break;
    }

    ctx.restore();
  },

  drawPartWing(ctx, wingId, ts) {
    const flap = Math.sin(ts * 0.009) * 0.16;
    ctx.save();
    ctx.translate(-2, 6);
    ctx.rotate(flap);

    switch (wingId) {
      case 'w_sprout':
        ctx.fillStyle = '#22c55e';
        ctx.strokeStyle = '#15803d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 2, 14, 7, -0.2, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        break;
      case 'w_breakfast':
        ctx.fillStyle = '#be123c';
        ctx.strokeStyle = '#fda4af';
        ctx.lineWidth = 2;
        roundRect(ctx, -12, -3, 24, 9, 4);
        ctx.fill(); ctx.stroke();
        break;
      case 'w_barber':
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-10, -4); ctx.lineTo(14, 6);
        ctx.moveTo(-10, 6); ctx.lineTo(14, -4);
        ctx.stroke();
        break;
      case 'w_muscle':
        ctx.fillStyle = '#d97706';
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(-4, 2, 7, 0, Math.PI * 2);
        ctx.arc(6, -3, 8, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        break;
      case 'w_knight':
        ctx.fillStyle = '#3b82f6';
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2.5;
        roundRect(ctx, -10, -7, 20, 18, 5);
        ctx.fill(); ctx.stroke();
        break;
      case 'w_ninja':
        ctx.fillStyle = '#94a3b8';
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'w_wizard':
        ctx.fillStyle = '#c084fc';
        ctx.fillRect(-9, -5, 16, 12);
        break;
      case 'w_cyber':
        ctx.fillStyle = '#06b6d4';
        ctx.beginPath();
        ctx.moveTo(-14, -4); ctx.lineTo(12, 0); ctx.lineTo(-10, 8);
        ctx.closePath();
        ctx.fill();
        break;
      case 'w_king':
        ctx.fillStyle = '#dc2626';
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-4, -8); ctx.lineTo(-22, 12); ctx.lineTo(6, 10);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        break;
      case 'w_angel':
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(-6, -2, 16, 8, -0.35, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        break;
      case 'w_dragon':
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(-6, -8); ctx.lineTo(-22, -16); ctx.lineTo(-14, 8); ctx.lineTo(4, 4);
        ctx.closePath();
        ctx.fill();
        break;
      case 'w_cthulhu':
      case 'w_void':
        ctx.fillStyle = '#4c1d95';
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(-4, 0, 15, 7, -0.3, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        break;
      default:
        ctx.fillStyle = '#facc15';
        ctx.strokeStyle = '#ca8a04';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(0, 2, 12, 7, -0.15, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        break;
    }

    ctx.restore();
  },

  drawBottomPitDropZone(ctx, ts) {
    const cx = this.width / 2;
    const cy = this.height - 78;
    const isOver = this.draggedDuck && this.draggedDuck.overPit;

    ctx.save();
    ctx.fillStyle = isOver ? 'rgba(225, 29, 72, 0.92)' : 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = isOver ? '#fde047' : '#f43f5e';
    ctx.lineWidth = isOver ? 4 : 2.5;
    roundRect(ctx, cx - 185, cy - 42, 370, 74, 20);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 17px "Microsoft JhengHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(isOver ? '🔥 放開滑鼠！立刻獻祭進中央大黑洞！🔥' : '🕳️ 拖曳到此處（或中央黑洞）獻祭淘汰鴨', cx, cy - 8);

    const info = evaluateDuckInfo(this.draggedDuck.duck);
    ctx.fillStyle = '#fde047';
    ctx.font = '13px "Microsoft JhengHei", sans-serif';
    ctx.fillText(`可獲得 +${info.rarity.sacrificeValue} 鴨幣 ＆ 累積【${info.rarity.name}${info.isFullSet ? '/套裝' : ''}】階梯祭品`, cx, cy + 18);
    ctx.restore();
  },

  drawMinimap(ctx) {
    if (typeof Game === 'undefined' || !Game.ready) return;
    const mw = 176;
    const mh = 128;
    const mx = this.width - mw - 18;
    const my = this.height - mh - 18;

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    roundRect(ctx, mx, my, mw, mh, 12);
    ctx.fill();
    ctx.stroke();

    const cx = mx + mw / 2;
    const cy = my + mh / 2 + 6;
    const scale = 0.048;

    ctx.fillStyle = '#a855f7';
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fill();

    const plots = Game.getAllPlots();
    this.plotDefinitions.forEach((def, idx) => {
      const p = plots[idx];
      if (idx >= 2 && (!p || !p.owner)) return;
      const px = cx + def.x * scale;
      const py = cy + def.y * scale;
      const isMine = Game.isMyPlot(idx);
      ctx.fillStyle = isMine ? '#facc15' : (p && p.owner ? '#38bdf8' : '#475569');
      ctx.fillRect(px - 18, py - 13, 36, 26);
    });

    const vx = cx + this.camera.x * scale;
    const vy = cy + this.camera.y * scale;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx - 16, vy - 11, 32, 22);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'bold 11px "Microsoft JhengHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🗺️ 雙人巨型領地雷達', cx, my + 16);
    ctx.restore();
  },

  renderDuckPortrait(canvasEl, duck) {
    if (!canvasEl || !duck) return;
    const pCtx = canvasEl.getContext('2d');
    const w = canvasEl.width;
    const h = canvasEl.height;
    pCtx.clearRect(0, 0, w, h);

    const info = evaluateDuckInfo(duck);
    const grad = pCtx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
    grad.addColorStop(0, info.rarity.bg);
    grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    pCtx.fillStyle = grad;
    pCtx.fillRect(0, 0, w, h);

    pCtx.save();
    pCtx.translate(w / 2, h / 2 + 10);
    pCtx.scale(1.45, 1.45);
    this.drawPartBody(pCtx, duck.body, 0);
    this.drawPartHead(pCtx, duck.head, 0);
    this.drawPartWing(pCtx, duck.wing, 0);
    pCtx.restore();
  }
};

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

window.WorldCanvas = WorldCanvas;
