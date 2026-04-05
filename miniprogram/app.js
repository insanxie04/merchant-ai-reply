// app.js — 小程序入口（无登录、无用户信息采集）
App({
  globalData: {
    /**
     * 后端 API 根地址（需 HTTPS，且已在微信公众平台配置为 request 合法域名）
     * 示例：https://your-domain.com
     * 勿以 / 结尾；与 Next 部署同源时路径为 /api/...
     */
    apiBase: "https://merchant-ai-reply.vercel.app",
  },

  onLaunch() {
    if (!this.globalData.apiBase) {
      console.warn(
        "[店评小帮] 请在本文件或发布前配置 globalData.apiBase 为已备案 HTTPS 域名"
      );
    }
  },
});
