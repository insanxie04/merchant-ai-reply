/** Web 端轻量化埋点，写入 localStorage，供作品集数据看板使用 */

const STORAGE_KEY = "dianping-xiaobang-analytics-v1";
const MAX_EVENTS = 8000;

export type AnalyticsEventName =
  | "page_view"
  | "upload"
  | "delete"
  | "ocr_click"
  | "ocr_suc"
  | "ocr_fail"
  | "gen_click"
  | "gen_suc"
  | "gen_fail"
  | "copy_click"
  | "collect_toggle"
  | "type_change"
  | "auto_recognize"
  | "append_req_used"
  | "clear_input"
  | "edit_reply"
  | "like"
  | "dislike";

export type AnalyticsRow = {
  t: number;
  name: AnalyticsEventName;
  payload?: Record<string, unknown>;
};

export function trackEvent(
  name: AnalyticsEventName,
  payload?: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  try {
    const row: AnalyticsRow = { t: Date.now(), name, ...(payload ? { payload } : {}) };
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: AnalyticsRow[] = raw ? (JSON.parse(raw) as AnalyticsRow[]) : [];
    list.push(row);
    while (list.length > MAX_EVENTS) list.shift();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota / parse */
  }
}
