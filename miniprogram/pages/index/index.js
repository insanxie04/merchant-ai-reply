/**
 * 首页：评价识别 + 参数选择 + AI 生成回复 + 收藏（全本地存储）
 * 无登录、无用户信息；合规文案避免第三方平台专属表述
 */
const C = require("../../utils/constants.js");
const api = require("../../utils/api.js");
const fav = require("../../utils/favorites.js");

const categoryRange = C.getCategoryPickerRange();
const styleRange = C.getStylePickerRange();
const CATEGORY_OTHER_INDEX = C.CATEGORY_PRESET_LIST.length;
const STYLE_CUSTOM_INDEX = C.PRESET_STYLE_LIST.length;

Page({
  data: {
    categoryOtherIndex: CATEGORY_OTHER_INDEX,
    styleCustomIndex: STYLE_CUSTOM_INDEX,
    categoryRange,
    styleRange,
    ratingRange: C.RATING_TYPES,
    categoryIndex: 0,
    styleIndex: 0,
    ratingIndex: 0,
    categoryCustomText: "",
    styleCustomText: "",
    review: "",
    reviewError: "",
    imageTempPath: "",
    loading: false,
    loadingKind: "idle",
    loadingHint: "",
    error: "",
    replyRows: [],
    replyFeedback: {},
    favorites: [],
    favoritesOpen: false,
    favoriteTab: "praise",
    filteredFavorites: [],
    canGenerate: false,
    showReviewClear: false,
    customToastVisible: false,
    customToastText: "",
    extraRequirements: "",
  },

  _toastTimer: null,

  onLoad() {
    const favorites = fav.loadFavorites();
    this.setData({
      favorites,
      favoritesOpen: favorites.length > 0,
    });
    this._updateFilteredFavorites();
    this._syncGenerateBtnState();
    this._syncReviewClear();
  },

  /** 将接口返回的文案列表转为带稳定 id 的行（避免 wx:key 与收藏状态错乱） */
  _rowsFromApiReplies(texts) {
    const arr = Array.isArray(texts) ? texts : [];
    return arr.map((t) => ({
      id: fav.createId(),
      text: typeof t === "string" ? t : "",
    }));
  },

  onUnload() {
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
  },

  showCustomToast(title) {
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    this.setData({ customToastVisible: true, customToastText: title });
    this._toastTimer = setTimeout(() => {
      this.setData({ customToastVisible: false });
      this._toastTimer = null;
    }, 1500);
  },

  _syncGenerateBtnState() {
    const has =
      !!(this.data.imageTempPath || (this.data.review || "").trim());
    this.setData({ canGenerate: has });
  },

  _syncReviewClear() {
    const show =
      !!(this.data.review || "").trim() && !this.data.loading;
    this.setData({ showReviewClear: show });
  },

  _scrollToResults() {
    setTimeout(() => {
      wx.pageScrollTo({
        selector: "#results-section-title",
        duration: 400,
        fail: () => {},
      });
    }, 150);
  },

  _updateFilteredFavorites() {
    const tab = this.data.favoriteTab;
    const list = (this.data.favorites || []).filter((x) => x.bucket === tab);
    this.setData({ filteredFavorites: list });
  },

  getEffectiveCategory() {
    const i = this.data.categoryIndex;
    if (i < CATEGORY_OTHER_INDEX) return C.CATEGORY_PRESET_LIST[i];
    return (this.data.categoryCustomText || "").trim();
  },

  getEffectivePersona() {
    if (this.data.styleIndex !== STYLE_CUSTOM_INDEX) return "";
    return (this.data.styleCustomText || "").trim();
  },

  getApiStyle() {
    const persona = this.getEffectivePersona();
    if (persona) return "亲切热情";
    if (this.data.styleIndex === STYLE_CUSTOM_INDEX) return "亲切热情";
    return C.PRESET_STYLE_LIST[this.data.styleIndex];
  },

  /** 非空时写入生成接口 optional 字段 */
  _applyExtraRequirementsToPayload(payload) {
    const ex = (this.data.extraRequirements || "").trim();
    if (ex) payload.extraRequirements = ex;
  },

  onExtraRequirementsInput(e) {
    this.setData({
      extraRequirements: (e.detail.value || "").slice(0, 200),
    });
  },

  onCategoryChange(e) {
    const i = Number(e.detail.value);
    const patch = { categoryIndex: i };
    if (i < CATEGORY_OTHER_INDEX) patch.categoryCustomText = "";
    this.setData(patch);
  },

  onStyleChange(e) {
    const i = Number(e.detail.value);
    const patch = { styleIndex: i };
    if (i < STYLE_CUSTOM_INDEX) patch.styleCustomText = "";
    this.setData(patch);
  },

  onRatingChange(e) {
    this.setData({ ratingIndex: Number(e.detail.value) });
  },

  onCategoryCustomInput(e) {
    this.setData({ categoryCustomText: e.detail.value.slice(0, 50) });
  },

  onStyleCustomInput(e) {
    this.setData({ styleCustomText: e.detail.value.slice(0, 100) });
  },

  onReviewInput(e) {
    const v = e.detail.value;
    const patch = { review: v, reviewError: "" };
    if (this.data.imageTempPath) {
      patch.imageTempPath = "";
    }
    this.setData(patch, () => {
      this._syncGenerateBtnState();
      this._syncReviewClear();
    });
  },

  clearReview() {
    if (this.data.loading) return;
    this.setData(
      {
        review: "",
        reviewError: "",
      },
      () => {
        this._syncGenerateBtnState();
        this._syncReviewClear();
      }
    );
  },

  /** 选择相册/拍照 */
  chooseImage() {
    if (this.data.loading) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const file = res.tempFiles[0];
        if (!file) return;
        if (file.size > C.MAX_IMAGE_BYTES) {
          this.showCustomToast("图片需小于4MB");
          return;
        }
        this.setData(
          {
            imageTempPath: file.tempFilePath,
            error: "",
          },
          () => {
            this._syncGenerateBtnState();
            this._syncReviewClear();
          }
        );
      },
    });
  },

  clearImage() {
    this.setData({ imageTempPath: "" }, () => {
      this._syncGenerateBtnState();
    });
  },

  /** 读取临时图片为 base64，推断 mime */
  _readImageBase64(tempPath) {
    let base64;
    try {
      const fs = wx.getFileSystemManager();
      base64 = fs.readFileSync(tempPath, "base64");
    } catch {
      throw new Error("读取图片失败");
    }
    const lower = (tempPath || "").toLowerCase();
    let mime = "image/jpeg";
    if (lower.endsWith(".png")) mime = "image/png";
    else if (lower.endsWith(".webp")) mime = "image/webp";
    else if (lower.endsWith(".gif")) mime = "image/gif";
    return { mimeType: mime, imageBase64: base64 };
  },

  async extractOnly() {
    if (this.data.loading) return;
    const path = this.data.imageTempPath;
    if (!path) {
      this.showCustomToast("请先选择图片");
      return;
    }
    this.setData({
      loading: true,
      loadingKind: "extract",
      loadingHint: "识别图片中…",
      error: "",
      replyRows: [],
      replyFeedback: {},
    });
    this._syncReviewClear();
    try {
      const { mimeType, imageBase64 } = this._readImageBase64(path);
      const text = await api.extractReviewFromImage(mimeType, imageBase64);
      this.setData(
        {
          review: text,
          reviewError: "",
          imageTempPath: "",
        },
        () => {
          this._syncGenerateBtnState();
          this._syncReviewClear();
        }
      );
      this.showCustomToast("识别成功");
    } catch (err) {
      const msg = err.message || "识图失败";
      this.setData({ error: msg });
      this.showCustomToast("识别失败，请重试");
    } finally {
      this.setData({ loading: false, loadingKind: "idle", loadingHint: "" }, () => {
        this._syncReviewClear();
      });
    }
  },

  /**
   * 生成回复：有图且无字则先识别再生成；已有文字则直接生成。
   * 识图 API 仅在本按钮（先识别分支）或用户点击「识别文字」时调用，无自动识图。
   */
  async generate() {
    if (this.data.loading) return;
    const path = this.data.imageTempPath;
    const trimmed = (this.data.review || "").trim();
    if (!path && !trimmed) {
      this.showCustomToast("请先上传截图或输入评价内容");
      return;
    }
    const cat = this.getEffectiveCategory();
    if (!cat) {
      this.showCustomToast("请选择或输入商家品类");
      return;
    }

    if (path && !trimmed) {
      this.setData({
        loading: true,
        loadingKind: "recognize_extract",
        loadingHint: "识别并生成中…",
        error: "",
        replyRows: [],
        replyFeedback: {},
        reviewError: "",
      });
      this._syncReviewClear();
      let chainPhase = "extract";
      try {
        const { mimeType, imageBase64 } = this._readImageBase64(path);
        const text = await api.extractReviewFromImage(mimeType, imageBase64);
        this.setData(
          {
            review: text,
            loadingKind: "recognize_generate",
            loadingHint: "生成回复中…",
          },
          () => {
            this._syncGenerateBtnState();
            this._syncReviewClear();
          }
        );
        chainPhase = "generate";
        const persona = this.getEffectivePersona();
        const payload = {
          review: text,
          category: cat,
          style: this.getApiStyle(),
          ratingType: C.RATING_TYPES[this.data.ratingIndex],
        };
        if (persona) payload.customPersona = persona;
        this._applyExtraRequirementsToPayload(payload);
        const replies = await api.generateReplies(payload);
        this.setData({ replyRows: this._rowsFromApiReplies(replies) });
        this.showCustomToast("生成成功");
        this._scrollToResults();
      } catch (err) {
        const msg = err.message || "处理失败";
        this.setData({ error: msg });
        if (chainPhase === "extract") {
          this.showCustomToast("识别失败，请重试");
        } else {
          this.showCustomToast("生成失败，请重试");
        }
      } finally {
        this.setData(
          { loading: false, loadingKind: "idle", loadingHint: "" },
          () => {
            this._syncReviewClear();
          }
        );
      }
      return;
    }

    if (!trimmed) {
      this.setData({ reviewError: "请粘贴或输入评价内容" });
      this.showCustomToast("请填写评价原文");
      return;
    }
    this.setData({
      loading: true,
      loadingKind: "generate",
      loadingHint: "生成中…",
      error: "",
      replyRows: [],
      replyFeedback: {},
      reviewError: "",
    });
    this._syncReviewClear();
    try {
      const persona = this.getEffectivePersona();
      const payload = {
        review: trimmed,
        category: cat,
        style: this.getApiStyle(),
        ratingType: C.RATING_TYPES[this.data.ratingIndex],
      };
      if (persona) payload.customPersona = persona;
      this._applyExtraRequirementsToPayload(payload);
      const replies = await api.generateReplies(payload);
      this.setData({ replyRows: this._rowsFromApiReplies(replies) });
      this.showCustomToast("生成成功");
      this._scrollToResults();
    } catch (err) {
      const msg = err.message || "生成失败";
      this.setData({ error: msg });
      this.showCustomToast("生成失败，请重试");
    } finally {
      this.setData(
        { loading: false, loadingKind: "idle", loadingHint: "" },
        () => {
          this._syncReviewClear();
        }
      );
    }
  },

  copyReply(e) {
    const i = Number(e.currentTarget.dataset.index);
    const row = this.data.replyRows[i];
    if (!row || !row.text) return;
    wx.setClipboardData({
      data: row.text,
      success: () => {
        this.showCustomToast("复制成功");
      },
    });
  },

  toggleFeedback(e) {
    const i = e.currentTarget.dataset.index;
    const kind = e.currentTarget.dataset.kind;
    const key = String(i);
    const cur = this.data.replyFeedback[key];
    const next = { ...this.data.replyFeedback };
    if (cur === kind) {
      delete next[key];
      this.showCustomToast("已取消反馈");
    } else {
      next[key] = kind;
      this.showCustomToast(kind === "like" ? "感谢反馈" : "已记录");
    }
    this.setData({ replyFeedback: next });
  },

  toggleFavorite(e) {
    const rowId = e.currentTarget.dataset.rowid;
    const text = (e.currentTarget.dataset.text || "").trim();
    if (!rowId || !text) return;
    const list = this.data.favorites.slice();
    const existing = list.find((f) => f.replyRowId === rowId);
    if (existing) {
      const next = list.filter((f) => f.id !== existing.id);
      const patch = { favorites: next };
      if (next.length === 0) patch.favoritesOpen = false;
      this.setData(patch);
      fav.saveFavorites(next);
      this._updateFilteredFavorites();
      this.showCustomToast("已取消收藏");
      return;
    }
    const ratingType = C.RATING_TYPES[this.data.ratingIndex];
    list.push({
      id: fav.createId(),
      text,
      replyRowId: rowId,
      savedAt: Date.now(),
      bucket: fav.ratingTypeToBucket(ratingType),
      note: "",
    });
    this.setData({ favorites: list });
    fav.saveFavorites(list);
    this._updateFilteredFavorites();
    this.showCustomToast("收藏成功");
  },

  toggleFavoritesPanel() {
    const nextOpen = !this.data.favoritesOpen;
    this.setData({ favoritesOpen: nextOpen });
    if (nextOpen) this._updateFilteredFavorites();
  },

  onFavoriteTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ favoriteTab: tab });
    this._updateFilteredFavorites();
  },

  onFavNoteInput(e) {
    const id = e.currentTarget.dataset.id;
    const note = e.detail.value;
    const list = this.data.favorites.map((f) =>
      f.id === id ? { ...f, note } : f
    );
    this.setData({ favorites: list });
    fav.saveFavorites(list);
    this._updateFilteredFavorites();
  },

  copyFavorite(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.favorites.find((f) => f.id === id);
    if (!item) return;
    wx.setClipboardData({
      data: item.text,
      success: () => this.showCustomToast("复制成功"),
    });
  },

  removeFavorite(e) {
    const id = e.currentTarget.dataset.id;
    const list = this.data.favorites.filter((f) => f.id !== id);
    const patch = { favorites: list };
    if (list.length === 0) patch.favoritesOpen = false;
    this.setData(patch);
    fav.saveFavorites(list);
    this._updateFilteredFavorites();
    this.showCustomToast("删除成功");
  },
});
