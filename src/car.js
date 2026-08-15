/**
 * 車両クラス (Car)
 * 上から下への走行、速度ブレ(±20%)、前車接近時90%減速、合流待機停車、1回限りの追越し
 */
class Car {
  constructor(id, lane, y, desiredSpeed, colorStyle = null) {
    this.id = id;
    this.lane = lane; // 0: 左車線, 1: 右車線
    this.targetLane = lane;
    this.y = y; // 道路上の縦位置 (メートル, 0〜1000m)
    this.xOffset = 0; // 車線変更時の横方向アニメーション (-1 to 1)

    this.length = 4.5; // 車体長 (m)
    this.width = 1.8;  // 車幅 (m)

    this.desiredSpeed = desiredSpeed; // 個体ごとの希望最高速度 (m/s)
    this.speed = desiredSpeed * 0.9;   // 初期速度 (m/s)
    this.acceleration = 0;             // 加速度 (m/s^2)

    // 物理パラメータ
    this.maxAcceleration = 2.0; // 加速性能 (m/s^2)
    this.comfortableDecel = 2.5; // 通常減速 (m/s^2)
    this.maxDecel = 7.0;        // 急ブレーキ (m/s^2)

    // 状態フラグ
    this.isBraking = false;
    this.signalState = 'none'; // 'none', 'left', 'right'
    this.isWaitingToMerge = false; // 空間がなく合流待ちで停車・減速中
    this.mergeProgress = 0;

    // 「前走車へ追いついた車だけが車線変更し、一度車線変更したらその車線のまま走る」ためのフラグ
    this.hasChangedLaneAfterBottleneck = false;

    // 統計用
    this.spawnTime = 0;
    this.finishTime = null;
    this.totalWaitTime = 0;

    this.colorStyle = colorStyle || this.generateRandomColor();
  }

  generateRandomColor() {
    const hues = [200, 215, 230, 260, 340, 15, 35, 45, 160];
    const hue = hues[Math.floor(Math.random() * hues.length)];
    const sat = 50 + Math.random() * 35;
    const light = 50 + Math.random() * 20;
    return `hsl(${hue}, ${sat}%, ${light}%)`;
  }

  /**
   * 1ステップの更新
   */
  update(dt, leader, params, road, strategy, simTime) {
    if (this.spawnTime === 0) this.spawnTime = simTime;

    // 1. 加速度の計算 (前車接近時90%減速ルール)
    this.acceleration = this.calculateAcceleration(leader, params);

    // 2. 速度と位置の更新
    this.speed = Math.max(0, this.speed + this.acceleration * dt);
    this.y += this.speed * dt;

    // 3. ブレーキ判定
    this.isBraking = this.acceleration < -0.5 || (this.speed < 1.0 && leader && (leader.y - leader.length - this.y) < 4) || (this.isWaitingToMerge && this.speed < 2.0);

    // 4. 車線変更のアニメーション補間
    if (this.lane !== this.targetLane) {
      this.mergeProgress += dt * 1.5; // 約0.65秒で車線移行完了
      if (this.mergeProgress >= 1.0) {
        this.lane = this.targetLane;
        this.mergeProgress = 0;
        this.xOffset = 0;
        this.signalState = 'none';
        this.isWaitingToMerge = false;
      } else {
        const t = this.mergeProgress;
        const ease = t * t * (3 - 2 * t);
        const dir = this.targetLane > this.lane ? 1 : -1;
        this.xOffset = dir * ease;
      }
    }

    if (this.speed < 4.16) { // < 15km/h
      this.totalWaitTime += dt;
    }
  }

  /**
   * 加速度計算
   * ユーザー要件:
   * 「眼の前の車に近づくと前の車の90%の速度まで減速し、離れると再度同じ速度まで加速するものとする」
   */
  calculateAcceleration(leader, params) {
    const v = this.speed;
    const v0 = this.desiredSpeed;
    const aMax = this.maxAcceleration;
    const bComf = this.comfortableDecel;
    const s0 = 2.5; // 最小車間 (m)
    const T = params.safeHeadway; // 希望車間時間 (秒)
    const decelFactor = params.decelerationRatio / 100; // 0.90 (90%)

    // 自由走行時の基本加速
    const freeTerm = 1 - Math.pow(v / Math.max(0.1, v0), 4);
    const freeAccel = aMax * freeTerm;

    if (!leader) {
      return Math.max(-this.maxDecel, Math.min(aMax, freeAccel));
    }

    // 前車との実車間距離 (前車の後端 - 自車の前端)
    const actualGap = leader.y - leader.length - this.y;

    if (actualGap <= 0.2) {
      return -this.maxDecel;
    }

    const deltaV = v - leader.speed;
    const dynamicTerm = (v * deltaV) / (2 * Math.sqrt(aMax * bComf));
    const desiredGap = s0 + Math.max(0, v * T + dynamicTerm);

    let interactionAccel = 0;

    // 前車に近づいた場合 (希望車間距離の1.25倍未満)
    if (actualGap < desiredGap * 1.25) {
      // 前車の速度の90%を目標として減速
      const targetFollowSpeed = leader.speed * decelFactor;
      const speedDiff = targetFollowSpeed - v;
      
      const gapRatio = desiredGap / Math.max(1.0, actualGap);
      const distanceFactor = Math.pow(gapRatio, 2);

      const idmDecel = aMax * Math.pow(desiredGap / actualGap, 2);
      const followDecel = (speedDiff / 1.0);

      interactionAccel = -Math.max(idmDecel, -followDecel * distanceFactor);
    }

    let finalAccel = freeAccel + interactionAccel;
    return Math.max(-this.maxDecel, Math.min(aMax, finalAccel));
  }

  getStatusColor() {
    const speedKmh = this.speed * 3.6;
    if (speedKmh < 15 || this.isWaitingToMerge) {
      return '#ef4444'; // 渋滞・停車待機 (赤)
    } else if (speedKmh < 45) {
      return '#f59e0b'; // 減速 (黄)
    } else {
      return '#10b981'; // 巡航 (緑)
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Car;
}
