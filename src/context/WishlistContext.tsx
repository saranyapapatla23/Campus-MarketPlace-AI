import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface WishlistContextType {
  wishlistedIds: Set<string>;
  loading: boolean;
  isWishlisted: (productId: string) => boolean;
  toggleWishlist: (productId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const WishlistContext = createContext<WishlistContextType | undefined>(undefined);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [wishlistedIds, setWishlistedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setWishlistedIds(new Set());
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('wishlist')
        .select('product_id')
        .eq('user_id', user.id);

      if (error) {
        console.error('[Wishlist] Error loading wishlist ids:', error);
        return;
      }
      setWishlistedIds(new Set((data || []).map((row) => row.product_id)));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isWishlisted = useCallback(
    (productId: string) => wishlistedIds.has(productId),
    [wishlistedIds]
  );

  const toggleWishlist = useCallback(
    async (productId: string) => {
      if (!user) {
        toast({
          title: 'Sign in required',
          description: 'Please sign in to save items to your wishlist.',
          variant: 'destructive',
        });
        return;
      }

      const alreadyWishlisted = wishlistedIds.has(productId);

      // Optimistic update so the heart icon flips instantly.
      setWishlistedIds((prev) => {
        const next = new Set(prev);
        if (alreadyWishlisted) {
          next.delete(productId);
        } else {
          next.add(productId);
        }
        return next;
      });

      if (alreadyWishlisted) {
        const { error } = await supabase
          .from('wishlist')
          .delete()
          .match({ user_id: user.id, product_id: productId });

        if (error) {
          console.error('[Wishlist] Error removing item:', error);
          // Revert optimistic update
          setWishlistedIds((prev) => new Set(prev).add(productId));
          toast({
            title: 'Could not remove item',
            description: error.message,
            variant: 'destructive',
          });
        }
      } else {
        // Dedup safeguard: the DB has a UNIQUE(user_id, product_id)
        // constraint as a backstop, but we also short-circuit locally.
        const { error } = await supabase
          .from('wishlist')
          .insert({ user_id: user.id, product_id: productId });

        if (error) {
          // 23505 = unique_violation -> already wishlisted elsewhere; treat as success.
          if (error.code !== '23505') {
            console.error('[Wishlist] Error adding item:', error);
            setWishlistedIds((prev) => {
              const next = new Set(prev);
              next.delete(productId);
              return next;
            });
            toast({
              title: 'Could not add item',
              description: error.message,
              variant: 'destructive',
            });
          }
        }
      }
    },
    [user, wishlistedIds, toast]
  );

  return (
    <WishlistContext.Provider
      value={{ wishlistedIds, loading, isWishlisted, toggleWishlist, refresh }}
    >
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (context === undefined) {
    throw new Error('useWishlist must be used within a WishlistProvider');
  }
  return context;
}
