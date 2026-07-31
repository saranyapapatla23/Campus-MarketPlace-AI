import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Order, Rating } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ReviewFormDialog from '@/components/reviews/ReviewFormDialog';
import { Package, ShoppingBag, Loader2, Star, CheckCircle2 } from 'lucide-react';
import { timeAgo } from '@/lib/utils';

export default function OrdersPage() {
  const { user } = useAuth();
  const [purchases, setPurchases] = useState<Order[]>([]);
  const [sales, setSales] = useState<Order[]>([]);
  const [myReviewsByOrder, setMyReviewsByOrder] = useState<Record<string, Rating>>({});
  const [loading, setLoading] = useState(true);
  const [reviewOrder, setReviewOrder] = useState<Order | null>(null);

  const loadOrders = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const orderSelect =
      '*, product:products(id, title, images, price, status), buyer:users!orders_buyer_id_fkey(id, full_name, avatar_url), seller:users!orders_seller_id_fkey(id, full_name, avatar_url)';

    const [purchasesRes, salesRes, myReviewsRes] = await Promise.all([
      supabase
        .from('orders')
        .select(orderSelect)
        .eq('buyer_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('orders')
        .select(orderSelect)
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false }),
      supabase.from('ratings').select('*').eq('rater_id', user.id),
    ]);

    if (purchasesRes.error) console.error('[Orders] load purchases failed:', purchasesRes.error);
    if (salesRes.error) console.error('[Orders] load sales failed:', salesRes.error);
    if (myReviewsRes.error) console.error('[Orders] load my reviews failed:', myReviewsRes.error);

    setPurchases(purchasesRes.data || []);
    setSales(salesRes.data || []);

    const reviewMap: Record<string, Rating> = {};
    for (const review of myReviewsRes.data || []) {
      if (review.order_id) reviewMap[review.order_id] = review;
    }
    setMyReviewsByOrder(reviewMap);

    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // Live updates - a sale you just made, or a purchase attributed to you,
  // appears without needing to refresh this page.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('orders-feed')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => loadOrders()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, loadOrders]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const renderOrderCard = (order: Order, perspective: 'buyer' | 'seller') => {
    const otherParty = perspective === 'buyer' ? order.seller : order.buyer;
    const existingReview = myReviewsByOrder[order.id];
    const canReview = perspective === 'buyer' && order.status === 'completed';

    return (
      <motion.div key={order.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-16 w-16 rounded-lg overflow-hidden bg-muted shrink-0">
              {order.product?.images?.[0] ? (
                <img
                  src={order.product.images[0]}
                  alt={order.product.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center">
                  <Package className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <Link
                to={order.product ? `/product/${order.product.id}` : '#'}
                className="font-medium hover:underline truncate block"
              >
                {order.product?.title || 'Deleted listing'}
              </Link>
              <p className="text-sm text-muted-foreground">
                {perspective === 'buyer' ? 'Sold by' : 'Sold to'}{' '}
                {otherParty?.full_name || 'a buyer not on CampusKart'}
              </p>
              <p className="text-xs text-muted-foreground">{timeAgo(order.created_at)}</p>
            </div>

            <div className="text-right shrink-0">
              <p className="font-semibold">₹{order.final_price}</p>
              <Badge variant="secondary" className="capitalize mt-1">
                {order.status}
              </Badge>
            </div>

            {canReview && (
              <div className="shrink-0">
                {existingReview ? (
                  <Button size="sm" variant="outline" onClick={() => setReviewOrder(order)}>
                    <CheckCircle2 className="h-4 w-4 mr-1 text-green-500" />
                    Review Submitted
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setReviewOrder(order)}>
                    <Star className="h-4 w-4 mr-1" />
                    Leave Review
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  return (
    <div className="min-h-screen pb-20 lg:pb-0 py-8">
      <div className="container px-4 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-muted-foreground">Your purchases and sales</p>
        </div>

        <Tabs defaultValue="purchases">
          <TabsList className="mb-6">
            <TabsTrigger value="purchases">
              <ShoppingBag className="h-4 w-4 mr-2" />
              My Purchases ({purchases.length})
            </TabsTrigger>
            <TabsTrigger value="sales">
              <Package className="h-4 w-4 mr-2" />
              My Sales ({sales.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="purchases">
            {purchases.length > 0 ? (
              <div className="space-y-4">{purchases.map((o) => renderOrderCard(o, 'buyer'))}</div>
            ) : (
              <div className="text-center py-16">
                <ShoppingBag className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">No purchases yet</h3>
                <p className="text-muted-foreground mb-6">
                  Items you buy from other sellers will show up here.
                </p>
                <Link to="/marketplace">
                  <Button className="bg-gradient-to-r from-blue-500 to-cyan-500">
                    Browse Marketplace
                  </Button>
                </Link>
              </div>
            )}
          </TabsContent>

          <TabsContent value="sales">
            {sales.length > 0 ? (
              <div className="space-y-4">{sales.map((o) => renderOrderCard(o, 'seller'))}</div>
            ) : (
              <div className="text-center py-16">
                <Package className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">No sales yet</h3>
                <p className="text-muted-foreground mb-6">
                  Mark a listing as sold from My Listings to see it here.
                </p>
                <Link to="/my-listings">
                  <Button className="bg-gradient-to-r from-blue-500 to-cyan-500">
                    Go to My Listings
                  </Button>
                </Link>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {reviewOrder && (
        <ReviewFormDialog
          order={reviewOrder}
          existingReview={myReviewsByOrder[reviewOrder.id] || null}
          open={!!reviewOrder}
          onOpenChange={(open) => {
            if (!open) setReviewOrder(null);
          }}
          onSubmitted={(review) => {
            setMyReviewsByOrder((prev) => ({ ...prev, [review.order_id as string]: review }));
            setReviewOrder(null);
          }}
        />
      )}
    </div>
  );
}
