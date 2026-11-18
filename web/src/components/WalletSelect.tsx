import { Select } from "@/components/ui/select"
import { shortId } from "@/lib/utils"
import type { LocalWallet } from "@/lib/store"

export function WalletSelect({ wallets, value, onChange, id }: { wallets: LocalWallet[]; value: string; onChange: (id: string) => void; id?: string }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {wallets.length === 0 && <option value="">No wallets yet</option>}
      {wallets.map((w) => (
        <option key={w.id} value={w.id}>
          {w.currency} wallet ({shortId(w.id)})
        </option>
      ))}
    </Select>
  )
}
