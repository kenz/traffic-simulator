/**
 * メインアプリケーション (App)
 * 同期スポナー管理、UI同期、リアルタイム描画ループ
 */
document.addEventListener('DOMContentLoaded', () => {
  // 1. 同期スポナーと2つのシミュレーションインスタンス
  const spawner = new SynchronizedSpawner(2000, 60, 20);
  const simEarly = new TrafficSimulation('early');
  const simZipper = new TrafficSimulation('zipper');

  let isRunning = false;
  let timeScale = 10.0; // 初期速度を10倍に設定
  let lastTimestamp = 0;
  let hoveredCar = null;
  let hoveredSim = null;

  const canvas = document.getElementById('simCanvas');
  const ctx = canvas.getContext('2d');
  const tooltip = document.getElementById('tooltip');
  const canvasWrapper = document.getElementById('canvas-wrapper');

  const btnPlayPause = document.getElementById('btn-play-pause');
  const playIcon = document.getElementById('play-icon');
  const playText = document.getElementById('play-text');
  const btnReset = document.getElementById('btn-reset');
  const speedButtons = document.querySelectorAll('.btn-speed');

  // 統計表示要素
  const earlyThroughput = document.getElementById('early-throughput');
  const earlyFlowRate = document.getElementById('early-flow-rate');
  const earlyAvgTime = document.getElementById('early-avg-time');
  const earlyDelayDiff = document.getElementById('early-delay-diff');
  const earlyJamLength = document.getElementById('early-jam-length');
  const earlyJamCars = document.getElementById('early-jam-cars');
  const earlyAvgSpeed = document.getElementById('early-avg-speed');

  const zipperThroughput = document.getElementById('zipper-throughput');
  const zipperFlowRate = document.getElementById('zipper-flow-rate');
  const zipperAvgTime = document.getElementById('zipper-avg-time');
  const zipperTimeGain = document.getElementById('zipper-time-gain');
  const zipperJamLength = document.getElementById('zipper-jam-length');
  const zipperJamCars = document.getElementById('zipper-jam-cars');
  const zipperAvgSpeed = document.getElementById('zipper-avg-speed');

  // パラメータ
  const paramTrafficRate = document.getElementById('param-traffic-rate');
  const dispTrafficRate = document.getElementById('disp-traffic-rate');
  const paramSpeedVariance = document.getElementById('param-speed-variance');
  const dispSpeedVariance = document.getElementById('disp-speed-variance');
  const paramDecelRatio = document.getElementById('param-decel-ratio');
  const dispDecelRatio = document.getElementById('disp-decel-ratio');
  const paramSafeHeadway = document.getElementById('param-safe-headway');
  const dispSafeHeadway = document.getElementById('disp-safe-headway');
  const btnDefaultParams = document.getElementById('btn-default-params');

  const statsChart = new StatsChart('statsChart');
  const chartTabs = document.querySelectorAll('.chart-tab');

  chartTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      chartTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      statsChart.setMetric(tab.dataset.chart);
    });
  });

  function resizeCanvas() {
    const rect = canvasWrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const canvasHeight = 640;
    canvas.width = rect.width * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.height = `${canvasHeight}px`;
    ctx.scale(dpr, dpr);
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // アニメーションループ
  function animate(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    lastTimestamp = timestamp;

    if (isRunning) {
      const fixedDt = 1 / 60;
      const steps = Math.round(timeScale);

      for (let s = 0; s < steps; s++) {
        // 公平な共通車両スポーン（両シミュレーションに同一データを注入）
        const carData = spawner.update(fixedDt);
        if (carData) {
          simEarly.spawnSynchronizedCar(carData);
          simZipper.spawnSynchronizedCar(carData);
        }

        simEarly.step(fixedDt);
        simZipper.step(fixedDt);
      }
      updateStatsUI();
    }

    render();
    statsChart.render(simEarly.stats.history, simZipper.stats.history);

    requestAnimationFrame(animate);
  }

  function updateStatsUI() {
    earlyThroughput.innerHTML = `${simEarly.stats.throughput} <small>台</small>`;
    earlyFlowRate.textContent = `${simEarly.stats.flowRatePerMin.toFixed(1)} 台/分`;
    earlyAvgTime.innerHTML = `${simEarly.stats.avgTravelTime.toFixed(1)} <small>秒</small>`;
    earlyJamLength.innerHTML = `${Math.round(simEarly.stats.jamLength)} <small>m</small>`;
    earlyJamCars.textContent = `渋滞車両: ${simEarly.stats.jamCarsCount}台`;
    earlyAvgSpeed.innerHTML = `${simEarly.stats.avgSpeedKmh.toFixed(1)} <small>km/h</small>`;

    zipperThroughput.innerHTML = `${simZipper.stats.throughput} <small>台</small>`;
    zipperFlowRate.textContent = `${simZipper.stats.flowRatePerMin.toFixed(1)} 台/分`;
    zipperAvgTime.innerHTML = `${simZipper.stats.avgTravelTime.toFixed(1)} <small>秒</small>`;
    zipperJamLength.innerHTML = `${Math.round(simZipper.stats.jamLength)} <small>m</small>`;
    zipperJamCars.textContent = `渋滞車両: ${simZipper.stats.jamCarsCount}台`;
    zipperAvgSpeed.innerHTML = `${simZipper.stats.avgSpeedKmh.toFixed(1)} <small>km/h</small>`;

    if (simEarly.stats.avgTravelTime > 0 && simZipper.stats.avgTravelTime > 0) {
      const diffSec = simEarly.stats.avgTravelTime - simZipper.stats.avgTravelTime;
      if (diffSec > 0) {
        zipperTimeGain.textContent = `左側より ${diffSec.toFixed(1)}秒 短縮 (${((diffSec / simEarly.stats.avgTravelTime) * 100).toFixed(0)}%改善)`;
        earlyDelayDiff.textContent = `遅延 +${diffSec.toFixed(1)}秒`;
      } else {
        zipperTimeGain.textContent = `同等ペース`;
        earlyDelayDiff.textContent = `-`;
      }
    }
  }

  function render() {
    const rect = canvasWrapper.getBoundingClientRect();
    const w = rect.width;
    const h = 640;

    ctx.clearRect(0, 0, w, h);
    const halfW = w / 2;

    // 左側道路: すぐ合流
    renderVerticalRoad(0, 0, halfW, h, simEarly, '【左側】すぐに合流（早期合流）', '#ef4444');

    // 中央境界線
    ctx.strokeStyle = '#2b394e';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(halfW, 10);
    ctx.lineTo(halfW, h - 10);
    ctx.stroke();
    ctx.setLineDash([]);

    // 右側道路: ファスナー合流
    renderVerticalRoad(halfW, 0, halfW, h, simZipper, '【右側】直前まで2車線で走りファスナー合流', '#10b981');
  }

  function renderVerticalRoad(rx, ry, rw, rh, sim, title, themeColor) {
    const roadLength = sim.road.length;
    const roadPaddingTop = 45;
    const roadHeight = rh - roadPaddingTop - 25;
    const scaleY = roadHeight / roadLength;

    const totalRoadWidth = Math.min(rw - 60, 160);
    const roadLeft = rx + (rw - totalRoadWidth) / 2;
    const laneW = totalRoadWidth / 2;

    // タイトル
    ctx.fillStyle = themeColor;
    ctx.fillRect(rx + 15, ry + 12, 4, 18);

    ctx.fillStyle = '#f0f4f8';
    ctx.font = 'bold 13px "Inter", "Noto Sans JP", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, rx + 26, ry + 21);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillText(`走行中: ${sim.cars.length}台 | 渋滞長: ${Math.round(sim.stats.jamLength)}m`, rx + 26, ry + 36);

    // 路面背景
    ctx.fillStyle = '#1e2530';
    ctx.fillRect(roadLeft, roadPaddingTop, totalRoadWidth, roadHeight);

    // 路肩白線
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(roadLeft, roadPaddingTop);
    ctx.lineTo(roadLeft, roadPaddingTop + roadHeight);
    ctx.moveTo(roadLeft + totalRoadWidth, roadPaddingTop);
    ctx.lineTo(roadLeft + totalRoadWidth, roadPaddingTop + roadHeight);
    ctx.stroke();

    // 中央車線境界線
    const taperStartY = roadPaddingTop + sim.road.taperStart * scaleY;
    const mergeY = roadPaddingTop + sim.road.mergePoint * scaleY;
    const reopenY = roadPaddingTop + sim.road.reopenTaperEnd * scaleY;

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 8]);

    ctx.beginPath();
    ctx.moveTo(roadLeft + laneW, roadPaddingTop);
    ctx.lineTo(roadLeft + laneW, taperStartY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(roadLeft + laneW, reopenY);
    ctx.lineTo(roadLeft + laneW, roadPaddingTop + roadHeight);
    ctx.stroke();
    ctx.setLineDash([]);

    // 規制エリア (右車線の閉鎖とコーン)
    const singleLaneEndY = roadPaddingTop + sim.road.singleLaneEnd * scaleY;

    ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
    ctx.beginPath();
    ctx.moveTo(roadLeft + totalRoadWidth, taperStartY);
    ctx.lineTo(roadLeft + laneW, mergeY);
    ctx.lineTo(roadLeft + laneW, singleLaneEndY);
    ctx.lineTo(roadLeft + totalRoadWidth, reopenY);
    ctx.closePath();
    ctx.fill();

    const coneCount = 8;
    for (let i = 0; i <= coneCount; i++) {
      const p = i / coneCount;
      const cy = taperStartY + (mergeY - taperStartY) * p;
      const cx = (roadLeft + totalRoadWidth) - (totalRoadWidth - laneW) * p;
      drawCone(cx - 2, cy);
    }

    const singleZoneCones = 6;
    for (let i = 1; i < singleZoneCones; i++) {
      const cy = mergeY + (singleLaneEndY - mergeY) * (i / singleZoneCones);
      drawCone(roadLeft + laneW + 4, cy);
    }

    for (let i = 0; i <= coneCount; i++) {
      const p = i / coneCount;
      const cy = singleLaneEndY + (reopenY - singleLaneEndY) * p;
      const cx = (roadLeft + laneW) + (totalRoadWidth - laneW) * p;
      drawCone(cx, cy);
    }

    // エリア案内
    if (sim.strategy === 'early') {
      const earlyStartY = roadPaddingTop + sim.road.earlyMergeStart * scaleY;
      ctx.fillStyle = '#f87171';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText('⚠️ すぐに合流 (100m〜)', roadLeft - 6, earlyStartY);

      ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(roadLeft, earlyStartY);
      ctx.lineTo(roadLeft + totalRoadWidth, earlyStartY);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = '#34d399';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('⚡ ファスナー合流 (470m)', roadLeft + totalRoadWidth + 6, taperStartY + 10);

      ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
      ctx.fillRect(roadLeft, taperStartY - 10, totalRoadWidth, mergeY - taperStartY + 10);
    }

    ctx.fillStyle = '#38bdf8';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = sim.strategy === 'early' ? 'right' : 'left';
    const labelX = sim.strategy === 'early' ? roadLeft - 6 : roadLeft + totalRoadWidth + 6;
    ctx.fillText('↗️ 2車線追越し可 (700m)', labelX, singleLaneEndY + 12);

    sim.cars.forEach(car => {
      drawVerticalCar(car, roadLeft, roadPaddingTop, laneW, scaleY);
    });
  }

  function drawCone(x, y) {
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 1, y - 1, 2, 1);
  }

  function drawVerticalCar(car, roadLeft, roadTop, laneW, scaleY) {
    const carY = roadTop + car.y * scaleY;
    const carH = Math.max(10, car.length * scaleY * 1.5);
    const carW = 12;

    let currentLaneIndex = car.lane;
    if (car.xOffset !== 0) {
      currentLaneIndex += car.xOffset;
    }

    const carX = roadLeft + (currentLaneIndex * laneW) + (laneW - carW) / 2;

    ctx.save();
    ctx.translate(carX, carY);

    // 影
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(1, 1, carW, carH);

    // 車体
    ctx.fillStyle = car.colorStyle;
    ctx.beginPath();
    ctx.roundRect(0, 0, carW, carH, 2.5);
    ctx.fill();

    // 速度状態ステータスバー
    ctx.fillStyle = car.getStatusColor();
    ctx.fillRect(2, carH * 0.25, carW - 4, carH * 0.5);

    // フロントガラス (下側)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fillRect(2, carH * 0.65, carW - 4, 2.5);

    // リアガラス (上側)
    ctx.fillRect(2, carH * 0.2, carW - 4, 2);

    // ヘッドライト (下端)
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(1, carH - 1, 2.5, 1.5);
    ctx.fillRect(carW - 3.5, carH - 1, 2.5, 1.5);

    // ブレーキランプ (上端)
    if (car.isBraking) {
      ctx.fillStyle = '#ff2222';
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 8;
      ctx.fillRect(1, -1.5, 3, 2.5);
      ctx.fillRect(carW - 4, -1.5, 3, 2.5);
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(1, 0, 2.5, 1.5);
      ctx.fillRect(carW - 3.5, 0, 2.5, 1.5);
    }

    // ウインカー点滅
    if (car.signalState !== 'none') {
      const blink = Math.floor(Date.now() / 220) % 2 === 0;
      if (blink) {
        ctx.fillStyle = '#fbbf24';
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 6;
        const blinkX = car.signalState === 'left' ? 0 : carW;
        ctx.beginPath();
        ctx.arc(blinkX, carH * 0.4, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // ホバー時ハイライト
    if (car === hoveredCar) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-2, -2, carW + 4, carH + 4);
    }

    ctx.restore();
  }

  // ツールチップ
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const halfW = rect.width / 2;

    const targetSim = mouseX < halfW ? simEarly : simZipper;
    const roadPaddingTop = 45;
    const roadHeight = 640 - roadPaddingTop - 25;
    const scaleY = roadHeight / targetSim.road.length;

    const mouseRoadY = (mouseY - roadPaddingTop) / scaleY;

    let nearestCar = null;
    let minDiff = 12;

    for (let car of targetSim.cars) {
      const dist = Math.abs(car.y - mouseRoadY);
      if (dist < minDiff) {
        nearestCar = car;
        minDiff = dist;
      }
    }

    if (nearestCar) {
      hoveredCar = nearestCar;
      hoveredSim = targetSim;
      tooltip.style.display = 'block';
      tooltip.style.left = `${Math.min(rect.width - 180, mouseX + 15)}px`;
      tooltip.style.top = `${mouseY + 15}px`;

      const speedKmh = (nearestCar.speed * 3.6).toFixed(1);
      const desiredKmh = (nearestCar.desiredSpeed * 3.6).toFixed(1);
      const accelText = nearestCar.acceleration >= 0 ? `+${nearestCar.acceleration.toFixed(2)}` : nearestCar.acceleration.toFixed(2);

      tooltip.innerHTML = `
        <strong>🚗 車両 #${nearestCar.id}</strong><br>
        現在速度: <strong>${speedKmh}</strong> km/h<br>
        希望巡航: ${desiredKmh} km/h<br>
        加速度: ${accelText} m/s²<br>
        位置: ${Math.round(nearestCar.y)} m / 1,000m<br>
        車線: ${nearestCar.lane === 0 ? '左車線' : '右車線'}<br>
        車線変更済: ${nearestCar.hasChangedLaneAfterBottleneck ? 'はい (固定)' : '未変更'}
        ${nearestCar.isWaitingToMerge ? '<br><span style="color:#f59e0b">⏳ 合流待機中 (空間待ち)</span>' : ''}
        ${nearestCar.isBraking ? '<br><span style="color:#f87171">● ブレーキ作動中</span>' : ''}
      `;
    } else {
      hoveredCar = null;
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    hoveredCar = null;
    tooltip.style.display = 'none';
  });

  btnPlayPause.addEventListener('click', () => {
    isRunning = !isRunning;
    if (isRunning) {
      playIcon.textContent = '⏸';
      playText.textContent = '一時停止';
      btnPlayPause.classList.add('paused');
    } else {
      playIcon.textContent = '▶';
      playText.textContent = '再開';
      btnPlayPause.classList.remove('paused');
    }
  });

  btnReset.addEventListener('click', () => {
    spawner.reset();
    simEarly.reset();
    simZipper.reset();
    updateStatsUI();
  });

  speedButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      speedButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      timeScale = parseFloat(btn.dataset.speed);
    });
  });

  function applyParams() {
    const params = {
      trafficRate: parseInt(paramTrafficRate.value, 10),
      speedVariance: parseInt(paramSpeedVariance.value, 10),
      decelerationRatio: parseInt(paramDecelRatio.value, 10),
      safeHeadway: parseFloat(paramSafeHeadway.value)
    };

    spawner.updateParams(params.trafficRate, params.speedVariance);
    simEarly.updateParams(params);
    simZipper.updateParams(params);

    dispTrafficRate.textContent = `${params.trafficRate.toLocaleString()} 台/時`;
    dispSpeedVariance.textContent = `±${params.speedVariance} %`;
    dispDecelRatio.textContent = `${params.decelerationRatio} %`;
    dispSafeHeadway.textContent = `${params.safeHeadway.toFixed(1)} 秒`;
  }

  [paramTrafficRate, paramSpeedVariance, paramDecelRatio, paramSafeHeadway].forEach(input => {
    input.addEventListener('input', applyParams);
  });

  btnDefaultParams.addEventListener('click', () => {
    paramTrafficRate.value = 2000;
    paramSpeedVariance.value = 20;
    paramDecelRatio.value = 90;
    paramSafeHeadway.value = 3.0;
    applyParams();
  });

  applyParams();
  btnPlayPause.click();
  requestAnimationFrame(animate);
});
