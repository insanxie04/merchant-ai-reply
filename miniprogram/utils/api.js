/**
 * 对接现有 Next.js API：/api/generate-replies、/api/extract-review-from-image
 * 发布前在 app.js 配置 globalData.apiBase（HTTPS + 合法域名）
 */

function getBase() {
  const base = getApp().globalData.apiBase || "";
  return base.replace(/\/$/, "");
}

/**
 * POST JSON，返回 { data, statusCode }
 * data 已为解析后的对象或 null
 */
function requestJson(path, body) {
  const base = getBase();
  if (!base) {
    return Promise.reject(new Error("请先在 app.js 中配置 apiBase 服务器地址"));
  }
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: "POST",
      header: { "Content-Type": "application/json" },
      data: body,
      timeout: 90000,
      success(res) {
        let data = res.data;
        if (typeof data === "string") {
          try {
            data = JSON.parse(data);
          } catch {
            data = null;
          }
        }
        resolve({ data, statusCode: res.statusCode });
      },
      fail(err) {
        reject(
          new Error(
            err.errMsg && err.errMsg.indexOf("fail") >= 0
              ? "网络异常，请检查网络或合法域名配置"
              : "请求失败"
          )
        );
      },
    });
  });
}

/** 生成 3 条回复 */
async function generateReplies(payload) {
  const { data, statusCode } = await requestJson("/api/generate-replies", payload);
  if (statusCode !== 200 || !data) {
    const msg =
      data && typeof data.error === "string" && data.error
        ? data.error
        : `请求失败（${statusCode}）`;
    throw new Error(msg);
  }
  if (
    !Array.isArray(data.replies) ||
    data.replies.length !== 3 ||
    !data.replies.every((r) => typeof r === "string")
  ) {
    throw new Error("返回数据格式异常");
  }
  return data.replies;
}

/** 图片识别评价文字 */
async function extractReviewFromImage(mimeType, imageBase64) {
  const { data, statusCode } = await requestJson(
    "/api/extract-review-from-image",
    { mimeType, imageBase64 }
  );
  if (statusCode !== 200 || !data) {
    const msg =
      data && typeof data.error === "string" && data.error
        ? data.error
        : `识图失败（${statusCode}）`;
    throw new Error(msg);
  }
  if (typeof data.review !== "string" || !data.review.trim()) {
    throw new Error("识图返回数据异常");
  }
  return data.review.trim();
}

module.exports = {
  requestJson,
  generateReplies,
  extractReviewFromImage,
};
