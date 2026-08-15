/**
 * 車両共通スポナー (SynchronizedSpawner)
 * 両シミュレーション（早期合流 vs ファスナー合流）に
 * まったく同じタイミング、同じ車線、同じ速度ブレの車両を公平に供給
 */
class SynchronizedSpawner {
  constructor(trafficRate = 2000, baseSpeedKmh = 60, speedVariance = 20) {
    this.trafficRate = trafficRate;
    this.baseSpeedKmh = baseSpeedKmh;
    this.speedVariance = speedVariance;
    this.spawnTimer = 0;
    this.nextCarId = 1;
    this.calcNextSpawnDelay();
  }

  calcNextSpawnDelay() {
    const meanInterval = 3600 / Math.max(100, this.trafficRate);
    const u = Math.max(0.0001, Math.random());
    this.nextSpawnDelay = -Math.log(u) * meanInterval;
  }

  updateParams(trafficRate, speedVariance, baseSpeedKmh = 60) {
    this.trafficRate = trafficRate;
    this.speedVariance = speedVariance;
    this.baseSpeedKmh = baseSpeedKmh;
  }

  reset() {
    this.spawnTimer = 0;
    this.nextCarId = 1;
    this.calcNextSpawnDelay();
  }

  /**
   * 1ステップ経過させて、発生すべき車両データがあれば生成して返す
   */
  update(dt) {
    this.spawnTimer += dt;
    if (this.spawnTimer >= this.nextSpawnDelay) {
      this.spawnTimer = 0;
      this.calcNextSpawnDelay();

      // 公平な車線選択 (左右50%の等確率ランダム)
      const spawnLane = Math.random() < 0.5 ? 0 : 1;

      // 速度ブレの計算 (基準速度 60km/h ± variance%)
      const baseSpeedMs = (this.baseSpeedKmh * 1000) / 3600;
      const varianceFactor = (Math.random() * 2 - 1) * (this.speedVariance / 100);
      const desiredSpeed = baseSpeedMs * (1 + varianceFactor);

      // カラーの決定
      const hues = [200, 215, 230, 260, 340, 15, 35, 45, 160];
      const hue = hues[Math.floor(Math.random() * hues.length)];
      const sat = 50 + Math.random() * 35;
      const light = 50 + Math.random() * 20;
      const colorStyle = `hsl(${hue}, ${sat}%, ${light}%)`;

      return {
        id: this.nextCarId++,
        lane: spawnLane,
        desiredSpeed: desiredSpeed,
        colorStyle: colorStyle
      };
    }
    return null;
  }
}

/**
 * シミュレーション実行エンジン (TrafficSimulation)
 */
class TrafficSimulation {
  constructor(strategy = 'early', options = {}) {
    this.strategy = strategy; // 'early' (左側: すぐ合流) または 'zipper' (右側: ファスナー合流)
    this.road = new Road();

    this.params = {
      trafficRate: 2000,         // 平均交通量 (台/時)
      baseSpeedKmh: 60,          // 基準速度 (km/h)
      speedVariance: 20,         // 速度ブレ (±20%)
      decelerationRatio: 90,     // 接近時の減速係数 (90%)
      safeHeadway: 3.0,          // 車間時間 (秒)
      earlyMergeStart: 100,      // すぐ合流の開始位置 (100m)
      ...options
    };

    this.cars = [];
    this.simTime = 0;
    this.zipperTurn = 0; // 0: 左車線先行, 1: 右車線先行 (ファスナー合流のターン)

    this.stats = {
      finishedCars: [],
      throughput: 0,
      flowRatePerMin: 0,
      avgTravelTime: 0,
      avgSpeedKmh: 0,
      jamLength: 0,
      jamCarsCount: 0,
      history: []
    };

    this.historyTimer = 0;
  }

  updateParams(newParams) {
    this.params = { ...this.params, ...newParams };
    if (newParams.earlyMergeStart) {
      this.road.earlyMergeStart = newParams.earlyMergeStart;
    }
  }

  reset() {
    this.cars = [];
    this.simTime = 0;
    this.zipperTurn = 0;
    this.stats = {
      finishedCars: [],
      throughput: 0,
      flowRatePerMin: 0,
      avgTravelTime: 0,
      avgSpeedKmh: 0,
      jamLength: 0,
      jamCarsCount: 0,
      history: []
    };
    this.historyTimer = 0;
  }

  spawnSynchronizedCar(carData) {
    if (!carData) return;

    const isBlocked = this.cars.some(c => c.lane === carData.lane && c.y < 12);
    if (!isBlocked) {
      const newCar = new Car(
        carData.id,
        carData.lane,
        0,
        carData.desiredSpeed,
        carData.colorStyle
      );
      this.cars.push(newCar);
    }
  }

  step(dt) {
    this.simTime += dt;
    this.historyTimer += dt;

    // 1. 合流および復帰後の追いつき車線変更制御
    this.processLaneChanges(dt);

    // 2. 物理挙動とIDM追従（前車90%減速）
    this.updateVehiclePhysics(dt);

    // 3. 道路終端(1000m)への到達と退出
    this.processExitingVehicles();

    // 4. 統計の集計
    this.calculateRealtimeStats();

    // 5. 履歴記録 (1秒ごと)
    if (this.historyTimer >= 1.0) {
      this.recordHistory();
      this.historyTimer = 0;
    }
  }

  /**
   * 車線変更・合流・追越し車線変更の処理
   */
  processLaneChanges(dt) {
    function carLength(c) {
      return c ? c.length : 4.5;
    }

    // ========================================================
    // パート1: ボトルネックへの合流 (右車線 -> 左車線, y < 500m の車のみが対象)
    // ========================================================
    const lane0CarsBeforeMerge = this.cars.filter(c => (c.lane === 0 || c.targetLane === 0) && c.y < this.road.mergePoint + 20).sort((a, b) => a.y - b.y);
    const lane1CarsBeforeMerge = this.cars.filter(c => (c.lane === 1 && c.targetLane === 1) && c.y < this.road.mergePoint).sort((a, b) => a.y - b.y);

    if (this.strategy === 'early') {
      // ========================================================
      // 【左側道路: すぐに合流 (100m地点から)】
      // ユーザー要件:
      // 「横方向に空間がある場合のみ合流し、空間がない場合は1車線に合流するところまでは速度を落として進み車線に余白ができたら合流してください。1車線部分まで合流できなかった場合は停車して合流できるまで待機してください。」
      // ========================================================
      for (let car of lane1CarsBeforeMerge) {
        if (car.y < this.road.earlyMergeStart) continue; // 100m未満は合流前

        // 左車線で自車の横にいる車を探す
        const targetLeader = lane0CarsBeforeMerge.find(c => c.y > car.y);
        const targetFollower = [...lane0CarsBeforeMerge].reverse().find(c => c.y <= car.y);

        const frontGap = targetLeader ? targetLeader.y - targetLeader.length - car.y : 999;
        const rearGap = targetFollower ? car.y - car.length - targetFollower.y : 999;

        // 横方向に安全な空間があるか判定
        const hasSpace = (frontGap > 5.5 && rearGap > 4.0);

        if (hasSpace) {
          // 空間がある場合: すぐに合流
          car.targetLane = 0;
          car.signalState = 'left';
          car.isWaitingToMerge = false;

          // 割り込まれた左後続車は90%減速ブレーキ
          if (targetFollower) {
            targetFollower.speed = Math.max(0, targetFollower.speed * (this.params.decelerationRatio / 100));
            targetFollower.isBraking = true;
          }
        } else {
          // 空間がない場合:
          car.signalState = 'left';

          if (car.y >= this.road.taperStart + 40) { // 490m付近（1車線化の直前）
            // 1車線部分まで合流できなかった場合は停車して待機
            car.isWaitingToMerge = true;
            car.speed = Math.max(0, car.speed - 4.0 * dt);
            if (car.y >= this.road.mergePoint - 8) {
              car.y = this.road.mergePoint - 8;
              car.speed = 0;
            }
            // 少しでも前方に隙間ができたら合流を試みる
            if (frontGap > 4.5 && rearGap > 2.0) {
              car.targetLane = 0;
              car.isWaitingToMerge = false;
            }
          } else {
            // 1車線に合流するところまでは速度を落として進む (徐行して横の隙間を伺う)
            car.isWaitingToMerge = true;
            // 速度上限を通常の半分程度に落とす
            const crawlSpeed = (this.params.baseSpeedKmh * 1000 / 3600) * 0.45;
            if (car.speed > crawlSpeed) {
              car.speed = Math.max(crawlSpeed, car.speed - 2.5 * dt);
            }
          }
        }
      }
    } else {
      // ========================================================
      // 【右側道路: ファスナー合流 (先頭で交互合流)】
      // ユーザー要件:
      // 「ファスナー合流は左右の車線で車が合流する空間がない場合は、交互に合流してください。」
      // ========================================================
      const zipperZoneStart = this.road.taperStart - 10; // 440m
      const rightCarsSorted = [...lane1CarsBeforeMerge].sort((a, b) => b.y - a.y);

      for (let rightCar of rightCarsSorted) {
        if (rightCar.y < zipperZoneStart) continue; // 440mまでは両車線で普通に走る

        rightCar.signalState = 'left';

        const targetLeader = lane0CarsBeforeMerge.find(c => c.y > rightCar.y);
        const targetFollower = [...lane0CarsBeforeMerge].reverse().find(c => c.y <= rightCar.y);

        const frontGap = targetLeader ? targetLeader.y - targetLeader.length - rightCar.y : 999;
        const rearGap = targetFollower ? rightCar.y - carLength(targetFollower) - targetFollower.y : 999;

        // 自由流時 (空間が十分にある場合)
        if (frontGap > 8.0 && rearGap > 5.0) {
          rightCar.targetLane = 0;
          continue;
        }

        // 空間がない場合 (渋滞・混雑時):
        // 先頭（450m〜500m）で交互合流ルールを適用
        if (rightCar.y >= this.road.taperStart) {
          // 左車線の後続車は必ず右車線の先頭車に1台分のスペースを譲る
          if (targetFollower && targetFollower.y > zipperZoneStart - 20) {
            targetFollower.speed = Math.max(0, Math.min(targetFollower.speed, rightCar.speed * 0.85));
            targetFollower.isBraking = true;
          }

          // 交互合流の実行
          if (frontGap > 2.0 || rightCar.y >= this.road.taperStart + 20) {
            rightCar.targetLane = 0;
          }
        }
      }
    }

    // ========================================================
    // パート2: 2車線復帰後の追いつき車線変更 (y >= 700m の区間)
    // ユーザー要件:
    // 「前走車へ追いついた車だけが車線変更し、一度車線変更したらその車線のまま走ってください」
    // ========================================================
    const reopenStart = this.road.singleLaneEnd; // 700m
    const allCarsInReopen = this.cars.filter(c => c.y >= reopenStart && c.y < this.road.length - 25 && c.lane === c.targetLane);

    for (let car of allCarsInReopen) {
      if (car.hasChangedLaneAfterBottleneck) continue;

      const sameLaneCarsAhead = this.cars.filter(c => (c.lane === car.lane || c.targetLane === car.lane) && c.y > car.y).sort((a, b) => a.y - b.y);
      const frontCar = sameLaneCarsAhead[0];

      if (frontCar) {
        const gapToFront = frontCar.y - frontCar.length - car.y;

        // 前走車へ追いついた場合のみ車線変更判定
        const isCaughtUp = gapToFront < 22 && frontCar.speed < car.desiredSpeed * 0.95;

        if (isCaughtUp) {
          const otherLane = 1 - car.lane;
          const otherLaneCars = this.cars.filter(c => (c.lane === otherLane || c.targetLane === otherLane));

          const otherLeader = otherLaneCars.find(c => c.y > car.y);
          const otherFollower = [...otherLaneCars].reverse().find(c => c.y <= car.y);

          const targetFrontGap = otherLeader ? otherLeader.y - otherLeader.length - car.y : 999;
          const targetRearGap = otherFollower ? car.y - otherFollower.length - otherFollower.y : 999;

          if (targetFrontGap > 12.0 && targetRearGap > 6.0) {
            car.targetLane = otherLane;
            car.signalState = otherLane === 1 ? 'right' : 'left';
            car.hasChangedLaneAfterBottleneck = true;
          }
        }
      }
    }
  }

  /**
   * 車両の物理挙動更新 (IDM & 前車90%減速)
   */
  updateVehiclePhysics(dt) {
    const sortedCars = [...this.cars].sort((a, b) => b.y - a.y);

    for (let i = 0; i < sortedCars.length; i++) {
      const car = sortedCars[i];

      let leader = null;
      let minDistance = Infinity;

      for (let j = 0; j < sortedCars.length; j++) {
        const other = sortedCars[j];
        if (other.id === car.id) continue;
        if (other.y <= car.y) continue;

        const isSameLane = other.lane === car.lane || other.targetLane === car.lane || other.lane === car.targetLane || (car.targetLane !== car.lane && other.targetLane === car.targetLane);
        if (isSameLane) {
          const dist = other.y - other.length - car.y;
          if (dist >= 0 && dist < minDistance) {
            minDistance = dist;
            leader = other;
          }
        }
      }

      // 早期合流側で合流できず停車待機中の車は、合流ポイント500m手前で停止
      if (car.lane === 1 && car.targetLane === 1 && car.y >= this.road.taperStart && car.y < this.road.mergePoint) {
        const distToObstacle = (this.road.mergePoint - 6) - car.y;
        if (distToObstacle >= 0 && distToObstacle < minDistance) {
          leader = { y: this.road.mergePoint - 6, length: 2, speed: 0 };
        }
      }

      car.update(dt, leader, this.params, this.road, this.strategy, this.simTime);
    }
  }

  processExitingVehicles() {
    const activeCars = [];
    for (let car of this.cars) {
      if (car.y >= this.road.length) {
        car.finishTime = this.simTime;
        const travelTime = car.finishTime - car.spawnTime;
        this.stats.finishedCars.push({
          id: car.id,
          travelTime: travelTime,
          avgSpeedKmh: (this.road.length / travelTime) * 3.6,
          finishTime: this.simTime
        });
        this.stats.throughput++;
      } else {
        activeCars.push(car);
      }
    }
    this.cars = activeCars;
  }

  calculateRealtimeStats() {
    if (this.simTime > 0) {
      this.stats.flowRatePerMin = this.stats.throughput / (this.simTime / 60);
    }

    if (this.stats.finishedCars.length > 0) {
      const totalTime = this.stats.finishedCars.reduce((sum, c) => sum + c.travelTime, 0);
      this.stats.avgTravelTime = totalTime / this.stats.finishedCars.length;
    }

    if (this.cars.length > 0) {
      const totalSpeedMs = this.cars.reduce((sum, c) => sum + c.speed, 0);
      this.stats.avgSpeedKmh = (totalSpeedMs / this.cars.length) * 3.6;
    } else {
      this.stats.avgSpeedKmh = this.params.baseSpeedKmh;
    }

    const jammedCars = this.cars.filter(c => c.speed < (25 / 3.6) && c.y < this.road.singleLaneEnd);
    this.stats.jamCarsCount = jammedCars.length;

    if (jammedCars.length >= 2) {
      const minY = Math.min(...jammedCars.map(c => c.y));
      const maxY = Math.max(...jammedCars.map(c => c.y));
      this.stats.jamLength = Math.max(0, maxY - minY);
    } else if (jammedCars.length === 1) {
      this.stats.jamLength = 10;
    } else {
      this.stats.jamLength = 0;
    }
  }

  recordHistory() {
    this.stats.history.push({
      time: Math.round(this.simTime),
      throughput: this.stats.throughput,
      avgSpeedKmh: parseFloat(this.stats.avgSpeedKmh.toFixed(1)),
      jamLength: Math.round(this.stats.jamLength),
      activeCars: this.cars.length
    });

    if (this.stats.history.length > 180) {
      this.stats.history.shift();
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TrafficSimulation, SynchronizedSpawner };
}
