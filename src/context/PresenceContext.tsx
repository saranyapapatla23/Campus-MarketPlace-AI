import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

interface PresenceContextType {
  onlineUserIds: Set<string>;
  isOnline: (userId: string) => boolean;
}

const PresenceContext = createContext<PresenceContextType | undefined>(undefined);

// A single global presence channel every signed-in user joins. Supabase
// Presence keeps a live roster in memory per-channel (not persisted to the
// DB - there's no "last seen" table, this is a live-only websocket signal,
// which is the right tool for "is this person online right now").
const PRESENCE_CHANNEL_NAME = 'presence:online-users';

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) {
      setOnlineUserIds(new Set());
      return;
    }

    const channel = supabase.channel(PRESENCE_CHANNEL_NAME, {
      config: { presence: { key: user.id } },
    });

    const syncOnlineIds = () => {
      const state = channel.presenceState();
      setOnlineUserIds(new Set(Object.keys(state)));
    };

    channel
      .on('presence', { event: 'sync' }, syncOnlineIds)
      .on('presence', { event: 'join' }, syncOnlineIds)
      .on('presence', { event: 'leave' }, syncOnlineIds)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ user_id: user.id, online_at: new Date().toISOString() });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const isOnline = (userId: string) => onlineUserIds.has(userId);

  return (
    <PresenceContext.Provider value={{ onlineUserIds, isOnline }}>
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence() {
  const context = useContext(PresenceContext);
  if (context === undefined) {
    throw new Error('usePresence must be used within a PresenceProvider');
  }
  return context;
}
