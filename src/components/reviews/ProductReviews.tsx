import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Rating } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Star, Loader2, MessageSquare } from 'lucide-react';
import { cn, timeAgo } from '@/lib/utils';

function StarRow({ rating, size = 'h-4 w-4' }: { rating: number; size?: string }) {
  return (
    <div className="flex">
      {[...Array(5)].map((_, i) => (
        <Star
          key={i}
          className={cn(size, i < rating ? 'text-yellow-500 fill-yellow-500' : 'text-gray-300')}
        />
      ))}
    </div>
  );
}

export default function ProductReviews({ productId }: { productId: string }) {
  const [reviews, setReviews] = useState<Rating[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    supabase
      .from('ratings')
      .select('*, rater:users(id, full_name, avatar_url)')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) console.error('[ProductReviews] load failed:', error);
        setReviews(data || []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  const avgRating =
    reviews.length > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <StarRow rating={Math.round(avgRating)} size="h-5 w-5" />
        {reviews.length > 0 ? (
          <span className="font-semibold">
            {avgRating.toFixed(1)}{' '}
            <span className="text-muted-foreground font-normal">
              ({reviews.length} Review{reviews.length === 1 ? '' : 's'})
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">No reviews yet</span>
        )}
      </div>

      {reviews.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p>Be the first verified buyer to review this product.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <Card key={review.id}>
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <Avatar>
                    <AvatarFallback>
                      {review.rater?.full_name?.charAt(0) || '?'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{review.rater?.full_name || 'Anonymous'}</p>
                        <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600 border-green-500/30">
                          Verified Purchase
                        </Badge>
                      </div>
                      <StarRow rating={review.rating} />
                    </div>
                    {review.review && (
                      <p className="text-sm text-muted-foreground mt-2">{review.review}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">{timeAgo(review.created_at)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
