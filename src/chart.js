/**
 * 自前軽量リアルタイムグラフ描画クラス (StatsChart)
 * 早期合流 vs ファスナー合流の時系列データを Canvas に美しく描画
 */
class StatsChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.currentMetric = 'throughput'; // 'throughput', 'speed', 'jam'
    this.setupResolution();

    window.addEventListener('resize', () => {
      this.setupResolution();
    });
  }

  setupResolution() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
  }

  setMetric(metric) {
    this.currentMetric = metric;
  }

  /**
   * グラフ描画ループ
   */
  render(earlyHistory, zipperHistory) {
    if (!this.width || !this.height) {
      this.setupResolution();
    }

    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // 背景クリア
    ctx.clearRect(0, 0, w, h);

    const padding = { top: 20, right: 25, bottom: 30, left: 50 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // 背景グリッド描画
    ctx.strokeStyle = '#2b394e';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    // データの最大値・最小値の計算
    let maxValue = 10;
    let unit = '';
    let metricTitle = '';

    if (this.currentMetric === 'throughput') {
      unit = ' 台';
      metricTitle = '累積通過台数 (台)';
      const maxE = earlyHistory.length ? Math.max(...earlyHistory.map(d => d.throughput)) : 0;
      const maxZ = zipperHistory.length ? Math.max(...zipperHistory.map(d => d.throughput)) : 0;
      maxValue = Math.max(10, Math.ceil(Math.max(maxE, maxZ) * 1.15));
    } else if (this.currentMetric === 'speed') {
      unit = ' km/h';
      metricTitle = '区間平均速度 (km/h)';
      maxValue = 70; // 制限速度60km/h + マージン
    } else if (this.currentMetric === 'jam') {
      unit = ' m';
      metricTitle = '渋滞末尾長 (m)';
      const maxE = earlyHistory.length ? Math.max(...earlyHistory.map(d => d.jamLength)) : 0;
      const maxZ = zipperHistory.length ? Math.max(...zipperHistory.map(d => d.jamLength)) : 0;
      maxValue = Math.max(100, Math.ceil(Math.max(maxE, maxZ) * 1.2));
    }

    // Y軸グリッド線とラベル (4分割)
    const gridRows = 4;
    for (let i = 0; i <= gridRows; i++) {
      const yVal = (maxValue / gridRows) * (gridRows - i);
      const yPos = padding.top + (chartH / gridRows) * i;

      ctx.beginPath();
      ctx.moveTo(padding.left, yPos);
      ctx.lineTo(w - padding.right, yPos);
      ctx.stroke();

      ctx.fillText(Math.round(yVal) + unit, padding.left - 8, yPos);
    }

    // X軸 (時間) の描画
    const maxPoints = Math.max(earlyHistory.length, zipperHistory.length, 10);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // タイトル表示
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'left';
    ctx.fillText(metricTitle, padding.left, 6);

    // 折れ線描画関数
    const drawLine = (data, color, metricKey) => {
      if (!data || data.length < 2) return;

      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      for (let i = 0; i < data.length; i++) {
        const val = data[i][metricKey];
        const xPos = padding.left + (i / (maxPoints - 1)) * chartW;
        const yPos = padding.top + chartH - (val / maxValue) * chartH;

        if (i === 0) {
          ctx.moveTo(xPos, yPos);
        } else {
          ctx.lineTo(xPos, yPos);
        }
      }
      ctx.stroke();

      // エリアの薄い塗りつぶし
      ctx.lineTo(padding.left + ((data.length - 1) / (maxPoints - 1)) * chartW, padding.top + chartH);
      ctx.lineTo(padding.left, padding.top + chartH);
      ctx.closePath();
      ctx.fillStyle = color === '#ef4444' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.08)';
      ctx.fill();

      // 最新ポイントにドット描画
      if (data.length > 0) {
        const last = data[data.length - 1];
        const lastVal = last[metricKey];
        const lastX = padding.left + ((data.length - 1) / (maxPoints - 1)) * chartW;
        const lastY = padding.top + chartH - (lastVal / maxValue) * chartH;

        ctx.beginPath();
        ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#0f141c';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };

    let metricKey = 'throughput';
    if (this.currentMetric === 'speed') metricKey = 'avgSpeedKmh';
    if (this.currentMetric === 'jam') metricKey = 'jamLength';

    // 早期合流（赤線）を描画
    drawLine(earlyHistory, '#ef4444', metricKey);

    // ファスナー合流（緑線）を描画
    drawLine(zipperHistory, '#10b981', metricKey);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StatsChart;
}
