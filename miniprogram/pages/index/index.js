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
    loadingHint: "",
    error: "",
    replies: [],
    replyFeedback: {},
    favorites: [],
    favoritesOpen: false,
    favoriteTab: "praise",
    filteredFavorites: [],
  },

  onLoad() {
    const favorites = fav.loadFavorites();
    this.setData({ favorites });
    this._updateFilteredFavorites();
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
    this.setData(patch);
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
          wx.showToast({
            title: "图片需小于4MB",
            icon: "none",
          });
          return;
        }
        this.setData({
          imageTempPath: file.tempFilePath,
          error: "",
        });
      },
    });
  },

  clearImage() {
    this.setData({ imageTempPath: "" });
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
      wx.showToast({ title: "请先选择图片", icon: "none" });
      return;
    }
    this.setData({ loading: true, loadingHint: "识别图片中…", error: "", replies: [], replyFeedback: {} });
    wx.showLoading({ title: "识别中…", mask: true });
    try {
      const { mimeType, imageBase64 } = this._readImageBase64(path);
      const text = await api.extractReviewFromImage(mimeType, imageBase64);
      this.setData({ review: text, reviewError: "" });
      wx.showToast({ title: "已填入识别结果", icon: "success" });
    } catch (err) {
      const msg = err.message || "识图失败";
      this.setData({ error: msg });
      wx.showToast({ title: msg, icon: "none", duration: 2500 });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false, loadingHint: "" });
    }
  },

  async recognizeAndGenerate() {
    if (this.data.loading) return;
    const path = this.data.imageTempPath;
    if (!path) {
      wx.showToast({ title: "请先选择图片", icon: "none" });
      return;
    }
    const cat = this.getEffectiveCategory();
    if (!cat) {
      wx.showToast({ title: "请选择或输入商家品类", icon: "none" });
      return;
    }
    this.setData({
      loading: true,
      loadingHint: "识别并生成中…",
      error: "",
      replies: [],
      replyFeedback: {},
      reviewError: "",
    });
    wx.showLoading({ title: "处理中…", mask: true });
    try {
      const { mimeType, imageBase64 } = this._readImageBase64(path);
      const text = await api.extractReviewFromImage(mimeType, imageBase64);
      this.setData({ review: text });
      wx.showLoading({ title: "生成回复中…", mask: true });
      const persona = this.getEffectivePersona();
      const payload = {
        review: text,
        category: cat,
        style: this.getApiStyle(),
        ratingType: C.RATING_TYPES[this.data.ratingIndex],
      };
      if (persona) payload.customPersona = persona;
      const replies = await api.generateReplies(payload);
      this.setData({ replies });
      wx.showToast({ title: "已生成3条回复", icon: "success" });
    } catch (err) {
      const msg = err.message || "处理失败";
      this.setData({ error: msg });
      wx.showToast({ title: msg, icon: "none", duration: 2500 });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false, loadingHint: "" });
    }
  },

  async generate() {
    if (this.data.loading) return;
    const trimmed = (this.data.review || "").trim();
    if (!trimmed) {
      this.setData({ reviewError: "请粘贴或输入评价内容" });
      wx.showToast({ title: "请填写评价原文", icon: "none" });
      return;
    }
    const cat = this.getEffectiveCategory();
    if (!cat) {
      wx.showToast({ title: "请选择或输入商家品类", icon: "none" });
      return;
    }
    this.setData({
      loading: true,
      loadingHint: "生成中…",
      error: "",
      replies: [],
      replyFeedback: {},
      reviewError: "",
    });
    wx.showLoading({ title: "生成中…", mask: true });
    try {
      const persona = this.getEffectivePersona();
      const payload = {
        review: trimmed,
        category: cat,
        style: this.getApiStyle(),
        ratingType: C.RATING_TYPES[this.data.ratingIndex],
      };
      if (persona) payload.customPersona = persona;
      const replies = await api.generateReplies(payload);
      this.setData({ replies });
      wx.showToast({ title: "已生成", icon: "success" });
    } catch (err) {
      const msg = err.message || "生成失败";
      this.setData({ error: msg });
      wx.showToast({ title: msg, icon: "none", duration: 2500 });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false, loadingHint: "" });
    }
  },

  copyReply(e) {
    const i = e.currentTarget.dataset.index;
    const text = this.data.replies[i];
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: `回复${i + 1}已复制`, icon: "success" });
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
      wx.showToast({ title: "已取消反馈", icon: "none" });
    } else {
      next[key] = kind;
      wx.showToast({
        title: kind === "like" ? "感谢反馈" : "已记录",
        icon: "success",
      });
    }
    this.setData({ replyFeedback: next });
  },

  toggleFavorite(e) {
    const i = e.currentTarget.dataset.index;
    const text = this.data.replies[i];
    if (!text) return;
    const list = this.data.favorites.slice();
    const existing = list.find((f) => f.text === text);
    if (existing) {
      const next = list.filter((f) => f.id !== existing.id);
      this.setData({ favorites: next });
      fav.saveFavorites(next);
      this._updateFilteredFavorites();
      wx.showToast({ title: "已取消收藏", icon: "success" });
      return;
    }
    const ratingType = C.RATING_TYPES[this.data.ratingIndex];
    list.push({
      id: fav.createId(),
      text,
      savedAt: Date.now(),
      bucket: fav.ratingTypeToBucket(ratingType),
      note: "",
    });
    this.setData({ favorites: list });
    fav.saveFavorites(list);
    this._updateFilteredFavorites();
    wx.showToast({ title: "已加入收藏", icon: "success" });
  },

  isFavorited(text) {
    return this.data.favorites.some((f) => f.text === text);
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
      success: () => wx.showToast({ title: "已复制", icon: "success" }),
    });
  },

  removeFavorite(e) {
    const id = e.currentTarget.dataset.id;
    const list = this.data.favorites.filter((f) => f.id !== id);
    this.setData({ favorites: list });
    fav.saveFavorites(list);
    this._updateFilteredFavorites();
    wx.showToast({ title: "已删除", icon: "success" });
  },
});
