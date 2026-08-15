/**
 * 道路環境クラス (Road)
 * 上から下への道路 (Y: 0m -> 1000m)
 * 2車線 -> 1車線 (車線規制) -> 再度2車線 (規制解除・追越し)
 */
class Road {
  constructor() {
    this.length = 1000; // 道路全長 (m)

    // 区間定義 (m)
    this.earlyMergeStart = 100;  // 左側: すぐに合流の開始位置 (100m)
    this.taperStart = 450;       // 規制コーンのテーパー開始位置 (450m)
    this.mergePoint = 500;       // 完全に1車線になる位置 (合流限界地点: 500m)
    this.singleLaneEnd = 700;    // 1車線規制終了位置 (ここから2車線再開)
    this.reopenTaperEnd = 740;   // 完全に2車線に復帰する位置 (740m)

    this.laneWidth = 3.5; // 車線幅 (m)
  }

  isRightLaneOpen(y) {
    if (y < this.taperStart) return true;
    if (y >= this.reopenTaperEnd) return true;
    return false;
  }

  isReopenArea(y) {
    return y >= this.singleLaneEnd;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Road;
}
