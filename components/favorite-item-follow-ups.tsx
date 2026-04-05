"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { followUpRowUiKey } from "@/lib/favorite-follow-up-ids";
import type {
  FavoriteFollowUpRecord,
  FavoriteItem,
} from "@/lib/favorites-storage";
import { cn } from "@/lib/utils";
import { Check, ClipboardList, Pencil } from "lucide-react";

export type FavoriteItemFollowUpsProps = {
  item: FavoriteItem;
  editingFollowUpKey: string | null;
  followUpEditDraft: string;
  setFollowUpEditDraft: (v: string) => void;
  followUpOrdinalMap: (list: FavoriteFollowUpRecord[]) => Map<string, number>;
  formatFollowUpDate: (ts: number) => string;
  onCopy: (text: string, index: number) => void;
  onSaveEdit: () => void;
  onBeginEdit: (
    favoriteId: string,
    followUpId: string,
    rowId: string,
    text: string
  ) => void;
  onToggleFollowUpAdopt: (
    favoriteId: string,
    followUpId: string,
    rowId: string
  ) => void;
};

const btnBase =
  "inline-flex h-auto shrink-0 items-center justify-center gap-1.5 rounded-[8px] border px-4 py-2 text-xs font-medium leading-[1.6] transition-colors";

export function FavoriteItemFollowUps({
  item,
  editingFollowUpKey,
  followUpEditDraft,
  setFollowUpEditDraft,
  followUpOrdinalMap,
  formatFollowUpDate,
  onCopy,
  onSaveEdit,
  onBeginEdit,
  onToggleFollowUpAdopt,
}: FavoriteItemFollowUpsProps) {
  const list = item.followUps ?? [];
  if (!list.length) return null;

  const ordMap = followUpOrdinalMap(list);
  const sortedDesc = [...list].sort((a, b) => b.createdAt - a.createdAt);

  const copyBtnClass = cn(
    btnBase,
    "border-0 bg-[#FFD54F] text-[#333333] shadow-[0_2px_4px_rgba(255,213,79,0.3)] hover:bg-[#FFCA28] hover:shadow-[0_3px_6px_rgba(255,202,40,0.4)] active:translate-y-px [&_svg]:text-[#333333]"
  );

  const outlineBtnClass = cn(
    btnBase,
    "border-[#E5E5E5] bg-white text-[#666666] hover:bg-[#FAFAFA] dark:border-border dark:bg-card dark:hover:bg-muted/50 [&_svg]:text-[#666666]"
  );

  return (
    <div className="mt-2 space-y-0 pt-2">
      <p className="mb-2 text-[11px] font-medium leading-[1.6] text-foreground">
        跟进回复
      </p>
      {sortedDesc.map((fu, roundIndex) => {
        const ord = ordMap.get(fu.id) ?? 1;
        const adoptedId = fu.isAdopted;
        const adoptedRow =
          adoptedId && fu.replyRows.some((r) => r.id === adoptedId)
            ? fu.replyRows.find((r) => r.id === adoptedId)!
            : null;
        const visibleRows = adoptedRow ? [adoptedRow] : fu.replyRows;
        const isLatest = roundIndex === 0;

        return (
          <div key={fu.id}>
            {roundIndex > 0 ? (
              <div
                className="my-4 h-px w-full bg-[#E5E5E5]"
                aria-hidden
              />
            ) : null}
            <div
              className="space-y-2"
              data-latest-follow-anchor={isLatest ? "" : undefined}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-medium leading-[1.6] text-foreground">
                  第{ord}次跟进
                  <span className="ml-2 text-xs font-normal leading-[1.6] text-[#999999]">
                    {formatFollowUpDate(fu.createdAt)}
                  </span>
                </p>
              </div>

              <div
                className="bg-white leading-[1.6]"
                style={{
                  borderLeft: "3px solid #999999",
                  borderRadius: 8,
                  padding: 12,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                }}
              >
                <p className="text-[11px] font-medium text-[#666666]">
                  【买家追评】
                </p>
                <p className="mt-2 whitespace-pre-wrap text-[11px] text-[#333333]">
                  {fu.buyerFollowUp}
                </p>
              </div>

              <div className="h-2" aria-hidden />

              <div>
                <p className="mb-2 text-[11px] font-medium leading-[1.6] text-[#333333]">
                  【商家回复】
                </p>
                <ul className="flex list-none flex-col gap-2 p-0">
                  {visibleRows.map((row) => {
                    const i = fu.replyRows.findIndex((r) => r.id === row.id);
                    const uiKey = followUpRowUiKey(item.id, fu.id, row.id);
                    const isEd = editingFollowUpKey === uiKey;
                    const isAdoptedView = Boolean(
                      adoptedRow && adoptedRow.id === row.id
                    );
                    return (
                      <li key={row.id} className="min-w-0">
                        <div
                          className={cn(
                            "bg-white leading-[1.6]",
                            isAdoptedView &&
                              "bg-[#FFF9E6] ring-1 ring-[#FFC107]"
                          )}
                          style={{
                            borderLeft: "3px solid #FFC107",
                            borderRadius: 8,
                            padding: 12,
                            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                          }}
                        >
                          <div className="relative min-h-0 flex-1">
                            <div className="min-w-0">
                              {isEd ? (
                                <Textarea
                                  value={followUpEditDraft}
                                  onChange={(e) =>
                                    setFollowUpEditDraft(e.target.value)
                                  }
                                  className="min-h-[6rem] w-full resize-y border-border/80 text-xs leading-[1.6] text-foreground shadow-none focus-visible:ring-ring/50"
                                  aria-label={`跟进回复 ${i + 1} 编辑`}
                                />
                              ) : (
                                <p className="text-xs leading-[1.6] text-[#333333]">
                                  {row.text}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="mt-3 shrink-0" aria-hidden>
                            <div className="h-px w-full bg-[#E5E5E5]" />
                          </div>
                          <div className="shrink-0 pt-3">
                            <div className="flex flex-nowrap items-center justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                className={copyBtnClass}
                                onClick={() =>
                                  onCopy(
                                    isEd ? followUpEditDraft : row.text,
                                    i
                                  )
                                }
                              >
                                <ClipboardList
                                  className="size-3.5"
                                  aria-hidden
                                />
                                复制
                              </Button>
                              {isEd ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className={cn(outlineBtnClass, "shrink-0")}
                                  onClick={onSaveEdit}
                                >
                                  <Check className="size-3.5" aria-hidden />
                                  保存
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className={cn(outlineBtnClass, "shrink-0")}
                                  onClick={() =>
                                    onBeginEdit(
                                      item.id,
                                      fu.id,
                                      row.id,
                                      row.text
                                    )
                                  }
                                >
                                  <Pencil className="size-3.5" aria-hidden />
                                  编辑
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                className={cn(
                                  btnBase,
                                  "shrink-0 gap-1.5 transition-all duration-100 active:translate-y-px",
                                  isAdoptedView
                                    ? copyBtnClass
                                    : cn(
                                        outlineBtnClass,
                                        "border-[#E5E5E5] bg-white"
                                      )
                                )}
                                aria-pressed={isAdoptedView}
                                onClick={() =>
                                  onToggleFollowUpAdopt(
                                    item.id,
                                    fu.id,
                                    row.id
                                  )
                                }
                              >
                                {isAdoptedView ? "已采用" : "采用"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
