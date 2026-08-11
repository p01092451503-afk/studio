import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Trash2, Video, ImagePlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SignedImage } from "@/components/SignedImage";
import { useCharacters } from "@/hooks/useCharacters";
import {
  useAssignLibraryAssetCharacter,
  useDeleteLibraryAsset,
  useLibraryAssets,
  type LibraryAssetRow,
} from "@/hooks/useLibraryAssets";

const UNASSIGNED = "__unassigned__";

export function MyLibraryDialog({
  open,
  onOpenChange,
  onPick,
  disabled,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onPick: (asset: LibraryAssetRow) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { data: assets = [], isLoading, error } = useLibraryAssets();
  const { data: characters = [] } = useCharacters();
  const assign = useAssignLibraryAssetCharacter();
  const remove = useDeleteLibraryAsset();
  const [filter, setFilter] = useState<string>("all");

  const groups = useMemo(() => {
    const filtered = filter === "all"
      ? assets
      : assets.filter((asset) => (asset.character_id ?? UNASSIGNED) === filter);
    const map = new Map<string, LibraryAssetRow[]>();
    for (const asset of filtered) {
      const key = asset.character_id ?? UNASSIGNED;
      map.set(key, [...(map.get(key) ?? []), asset]);
    }
    return Array.from(map.entries());
  }, [assets, filter]);

  const nameFor = (key: string) =>
    key === UNASSIGNED
      ? t("mylib.unassigned")
      : characters.find((character) => character.id === key)?.display_name ?? t("mylib.unassigned");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("mylib.dialog_title")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t("mylib.hint")}</p>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">{t("mylib.filter_label")}</span>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("mylib.filter_all")}</SelectItem>
              <SelectItem value={UNASSIGNED}>{t("mylib.unassigned")}</SelectItem>
              {characters.map((character) => (
                <SelectItem key={character.id} value={character.id}>{character.display_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> {t("mylib.loading")}
          </div>
        )}
        {error && <p className="py-6 text-center text-sm text-destructive">{t("mylib.load_error")}</p>}
        {!isLoading && !error && groups.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">{t("mylib.empty")}</p>
        )}

        <div className="space-y-6">
          {groups.map(([key, items]) => (
            <section key={key} className="space-y-3">
              <h3 className="text-sm font-bold">{nameFor(key)} <span className="text-muted-foreground">({items.length})</span></h3>
              <div className="grid gap-3 sm:grid-cols-3">
                {items.map((asset) => (
                  <div key={asset.id} className="overflow-hidden rounded-lg border border-border bg-muted/30">
                    <SignedImage bucket="character-refs" path={asset.cover_path} alt={asset.name} className="aspect-video w-full object-cover" />
                    <div className="space-y-2 p-2.5">
                      <div className="flex items-center gap-1.5">
                        {asset.kind === "video" ? <Video className="h-3.5 w-3.5 text-primary" /> : <ImagePlus className="h-3.5 w-3.5 text-primary" />}
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{asset.name}</span>
                      </div>
                      <Select
                        value={asset.character_id ?? UNASSIGNED}
                        onValueChange={(value) => assign.mutate({ id: asset.id, characterId: value === UNASSIGNED ? null : value })}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNASSIGNED}>{t("mylib.unassigned")}</SelectItem>
                          {characters.map((character) => (
                            <SelectItem key={character.id} value={character.id}>{character.display_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex gap-1.5">
                        <Button size="sm" className="flex-1" disabled={disabled} onClick={() => onPick(asset)}>
                          <Plus className="h-3.5 w-3.5" /> {t("mylib.use")}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t("mylib.delete")} onClick={() => remove.mutate(asset.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
