import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Order, Rating } from '@/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Star, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface ReviewFormDialogProps {
  order: Order;
  existingReview: Rating | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted: (review: Rating) => void;
}

export default function ReviewFormDialog({
  order,
  existingReview,
  open,
  onOpenChange,
  onSubmitted,
}: ReviewFormDialogProps) {
  const { toast } = useToast();
  const [rating, setRating] = useState(existingReview?.rating ?? 5);
  const [hoverRating, setHoverRating] = useState(0);
  const [reviewText, setReviewText] = useState(existingReview?.review ?? '');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      let data: Rating | null = null;
      let error;

      if (existingReview) {
        ({ data, error } = await supabase
          .from('ratings')
          .update({ rating, review: reviewText })
          .eq('id', existingReview.id)
          .select('*')
          .single());
      } else {
        ({ data, error } = await supabase
          .from('ratings')
          .insert({
            rater_id: order.buyer_id,
            rated_user_id: order.seller_id,
            order_id: order.id,
            product_id: order.product_id,
            rating,
            review: reviewText,
          })
          .select('*')
          .single());
      }

      if (error) throw error;

      toast({ title: existingReview ? 'Review updated' : 'Review submitted' });
      if (data) onSubmitted(data);
      onOpenChange(false);
    } catch (err) {
      console.error('[ReviewFormDialog] submit failed:', err);
      toast({
        title: 'Could not submit review',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existingReview ? 'Edit your review' : 'Leave a review'}</DialogTitle>
          <DialogDescription>
            {order.product?.title ? `For "${order.product.title}"` : 'For your purchase'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex justify-center gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setRating(value)}
                onMouseEnter={() => setHoverRating(value)}
                onMouseLeave={() => setHoverRating(0)}
                className="p-1"
                aria-label={`${value} star${value === 1 ? '' : 's'}`}
              >
                <Star
                  className={cn(
                    'h-8 w-8 transition-colors',
                    (hoverRating || rating) >= value
                      ? 'text-yellow-500 fill-yellow-500'
                      : 'text-gray-300'
                  )}
                />
              </button>
            ))}
          </div>

          <Textarea
            placeholder="How was the product? Was it as described?"
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
            rows={4}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {existingReview ? 'Save Changes' : 'Submit Review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
