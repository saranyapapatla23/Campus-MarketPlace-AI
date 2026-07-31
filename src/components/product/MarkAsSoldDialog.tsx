import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Product, User } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

interface MarkAsSoldDialogProps {
  product: Product;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the product has been successfully marked sold. */
  onSold: () => void;
}

const NO_BUYER_VALUE = '__no_buyer__';

// Candidate buyers are people who actually interacted with this listing -
// they either messaged the seller about it, or wishlisted it - rather
// than an open-ended "search all users" picker, since those are the
// people who realistically bought it.
async function loadCandidateBuyers(productId: string, sellerId: string): Promise<User[]> {
  const [messagesRes, wishlistRes] = await Promise.all([
    supabase
      .from('messages')
      .select('sender_id, receiver_id, sender:users!messages_sender_id_fkey(*), receiver:users!messages_receiver_id_fkey(*)')
      .eq('product_id', productId),
    supabase
      .from('wishlist')
      .select('user_id, user:users(*)')
      .eq('product_id', productId),
  ]);

  const buyers = new Map<string, User>();

  for (const row of messagesRes.data || []) {
    const other = (row.sender_id === sellerId ? row.receiver : row.sender) as unknown as User | null;
    if (other && other.id !== sellerId) buyers.set(other.id, other);
  }
  for (const row of wishlistRes.data || []) {
    const other = row.user as unknown as User | undefined;
    if (other && other.id !== sellerId) buyers.set(other.id, other);
  }

  return Array.from(buyers.values());
}

export default function MarkAsSoldDialog({ product, open, onOpenChange, onSold }: MarkAsSoldDialogProps) {
  const { toast } = useToast();
  const [candidates, setCandidates] = useState<User[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [buyerId, setBuyerId] = useState<string>(NO_BUYER_VALUE);
  const [finalPrice, setFinalPrice] = useState<string>(String(product.price));
  const [submitting, setSubmitting] = useState(false);

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (next && candidates.length === 0 && !loadingCandidates) {
      setLoadingCandidates(true);
      loadCandidateBuyers(product.id, product.seller_id)
        .then(setCandidates)
        .finally(() => setLoadingCandidates(false));
    }
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const price = parseFloat(finalPrice);
      const { error } = await supabase.rpc('mark_product_sold', {
        p_product_id: product.id,
        p_buyer_id: buyerId === NO_BUYER_VALUE ? null : buyerId,
        p_final_price: Number.isFinite(price) ? price : null,
      });

      if (error) throw error;

      toast({ title: 'Marked as sold', description: `"${product.title}" is now marked as sold.` });
      onOpenChange(false);
      onSold();
    } catch (err) {
      console.error('[MarkAsSoldDialog] mark_product_sold failed:', err);
      toast({
        title: 'Could not mark as sold',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark "{product.title}" as sold</DialogTitle>
          <DialogDescription>
            This creates an order record so it shows up in Orders for you (and the buyer, if you pick one).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Who bought it?</Label>
            <Select value={buyerId} onValueChange={setBuyerId}>
              <SelectTrigger>
                <SelectValue placeholder={loadingCandidates ? 'Loading...' : 'Select a buyer'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_BUYER_VALUE}>No buyer on CampusKart (sold offline)</SelectItem>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Showing people who messaged you or wishlisted this item.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="final-price">Final sale price (₹)</Label>
            <Input
              id="final-price"
              type="number"
              min="0"
              step="0.01"
              value={finalPrice}
              onChange={(e) => setFinalPrice(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Confirm Sale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
