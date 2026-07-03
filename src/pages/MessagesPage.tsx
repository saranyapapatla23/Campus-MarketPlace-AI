import { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { usePresence } from '@/context/PresenceContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  MessageCircle,
  Send,
  ArrowLeft,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message, User as UserType } from '@/types';

export default function MessagesPage() {
  const { user } = useAuth();
  const { isOnline } = usePresence();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [conversations, setConversations] = useState<
    (Message & { otherUser: UserType })[]
  >([]);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [otherUser, setOtherUser] = useState<UserType | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [conversationSearch, setConversationSearch] = useState('');
  const [otherTyping, setOtherTyping] = useState(false);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const otherTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(0);

  // Get initial user/product from URL params if provided (e.g. from "Contact Seller")
  const initialUserId = searchParams.get('user');
  const initialProductId = searchParams.get('product');
  const [activeProduct, setActiveProduct] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    if (user) {
      loadConversations();
      if (initialUserId) {
        startNewConversation(initialUserId, initialProductId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, initialUserId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, otherTyping]);

  // Single page-level realtime subscription (not tied to which chat is
  // open) so the conversation list, unread dots, and last-message previews
  // update live regardless of what the user is currently looking at.
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`messages-inbox:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${user.id}`,
        },
        (payload) => {
          const msg = payload.new as Message;
          appendIfOpenChat(msg);
          loadConversations();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `sender_id=eq.${user.id}`,
        },
        (payload) => {
          // Messages we sent from another tab/device - reflect them here too.
          const msg = payload.new as Message;
          appendIfOpenChat(msg);
          loadConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, selectedChat]);

  // Adds an incoming realtime message to the open thread, de-duplicating
  // against messages we already have (e.g. the one we just optimistically
  // inserted ourselves after a successful send).
  const appendIfOpenChat = (msg: Message) => {
    setMessages((prev) => {
      if (!selectedChat) return prev;
      const belongsToOpenChat =
        (msg.sender_id === selectedChat && msg.receiver_id === user?.id) ||
        (msg.receiver_id === selectedChat && msg.sender_id === user?.id);
      if (!belongsToOpenChat) return prev;
      if (prev.some((m) => m.id === msg.id)) return prev;
      if (msg.sender_id === selectedChat) setOtherTyping(false);
      return [...prev, msg];
    });
  };

  useEffect(() => {
    if (selectedChat) {
      loadMessages(selectedChat);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChat]);

  // Per-conversation typing indicator. Uses a lightweight broadcast channel
  // (not persisted to the DB - typing status is inherently ephemeral) keyed
  // by the sorted pair of participant ids so both sides join the same
  // channel regardless of who opened the chat first.
  useEffect(() => {
    setOtherTyping(false);
    if (otherTypingTimeoutRef.current) clearTimeout(otherTypingTimeoutRef.current);

    if (!user || !selectedChat) {
      typingChannelRef.current = null;
      return;
    }

    const key = [user.id, selectedChat].sort().join('_');
    const channel = supabase
      .channel(`typing:${key}`)
      .on('broadcast', { event: 'typing' }, (payload) => {
        if (payload.payload?.user_id !== user.id) {
          setOtherTyping(true);
          if (otherTypingTimeoutRef.current) clearTimeout(otherTypingTimeoutRef.current);
          otherTypingTimeoutRef.current = setTimeout(() => setOtherTyping(false), 3000);
        }
      })
      .subscribe();

    typingChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
      if (otherTypingTimeoutRef.current) clearTimeout(otherTypingTimeoutRef.current);
    };
  }, [user?.id, selectedChat]);

  const handleMessageInputChange = (value: string) => {
    setNewMessage(value);
    if (!typingChannelRef.current || !user) return;
    // Throttle so we broadcast at most once every 1.5s while typing, not
    // on every keystroke.
    const now = Date.now();
    if (now - lastTypingSentRef.current > 1500) {
      lastTypingSentRef.current = now;
      typingChannelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: { user_id: user.id },
      });
    }
  };

  const loadConversations = async () => {
    setLoading(true);
    const { data: messages } = await supabase
      .from('messages')
      .select('*, sender:users!messages_sender_id_fkey(*), receiver:users!messages_receiver_id_fkey(*)')
      .or(`sender_id.eq.${user?.id},receiver_id.eq.${user?.id}`)
      .order('created_at', { ascending: false });

    if (messages) {
      // Group by conversation
      const convMap = new Map<string, any>();
      messages.forEach((msg) => {
        const otherId = msg.sender_id === user?.id ? msg.receiver_id : msg.sender_id;
        if (!convMap.has(otherId)) {
          const otherUser = msg.sender_id === user?.id ? msg.receiver : msg.sender;
          convMap.set(otherId, { ...msg, otherUser });
        }
      });
      setConversations(Array.from(convMap.values()));
    }
    setLoading(false);
  };

  const startNewConversation = async (userId: string, productId?: string | null) => {
    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    if (userData) {
      setOtherUser(userData);
      setSelectedChat(userId);
      setMessages([]);
    }
    if (productId) {
      const { data: productData } = await supabase
        .from('products')
        .select('id, title')
        .eq('id', productId)
        .single();
      if (productData) {
        setActiveProduct(productData);
      }
    } else {
      setActiveProduct(null);
    }
  };

  const loadMessages = async (otherId: string) => {
    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('id', otherId)
      .single();
    setOtherUser(userData);

    const { data: msgs } = await supabase
      .from('messages')
      .select('*, sender:users(*), receiver:users(*)')
      .or(`and(sender_id.eq.${user?.id},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${user?.id})`)
      .order('created_at', { ascending: true });
    setMessages(msgs || []);

    // Mark as read
    await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('receiver_id', user?.id)
      .eq('sender_id', otherId)
      .eq('is_read', false);
  };

  const sendMessage = async () => {
    console.log('[Messages] Send clicked');
    console.log('[Messages] user:', user?.id);
    console.log('[Messages] selectedChat:', selectedChat);
    console.log('[Messages] newMessage:', newMessage.trim());
    console.log('[Messages] sending:', sending);

    if (!newMessage.trim()) {
      console.log('[Messages] Empty message, returning');
      return;
    }
    if (!selectedChat) {
      console.log('[Messages] No selected chat, returning');
      return;
    }
    if (!user) {
      console.log('[Messages] No user, returning');
      return;
    }
    if (sending) {
      console.log('[Messages] Already sending, returning');
      return;
    }

    setSending(true);
    const messagePayload = {
      sender_id: user.id,
      receiver_id: selectedChat,
      content: newMessage.trim(),
      product_id: activeProduct?.id,
    };

    console.log('[Messages] Inserting message:', messagePayload);

    try {
      const { data, error } = await supabase
        .from('messages')
        .insert(messagePayload)
        .select('*, sender:users(*), receiver:users(*)')
        .single();

      console.log('[Messages] Insert result - data:', data);
      console.log('[Messages] Insert result - error:', error);

      if (error) {
        console.error('[Messages] FULL ERROR:', JSON.stringify(error, null, 2));
        toast({
          title: 'Failed to send message',
          description: error.message,
          variant: 'destructive',
        });
      } else if (data) {
        console.log('[Messages] Message sent successfully');
        setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
        setNewMessage('');
        loadConversations();
        toast({ title: 'Message sent' });
      }
    } catch (err) {
      console.error('[Messages] Exception:', err);
      toast({
        title: 'Failed to send message',
        description: 'An unexpected error occurred',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (date: string) => {
    const d = new Date(date);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const filteredConversations = conversations.filter((conv) =>
    conv.otherUser.full_name.toLowerCase().includes(conversationSearch.toLowerCase())
  );

  return (
    <div className="min-h-screen pb-20 lg:pb-0">
      <div className="container max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Messages</h1>

        <div className="grid lg:grid-cols-[300px,1fr] gap-4">
          {/* Conversations List */}
          <Card className="h-[calc(100vh-200px)]">
            <CardHeader className="border-b">
              <div className="relative">
                <Input
                  placeholder="Search conversations..."
                  className="pl-10"
                  value={conversationSearch}
                  onChange={(e) => setConversationSearch(e.target.value)}
                />
              </div>
            </CardHeader>
            <ScrollArea className="h-[calc(100%-60px)]">
              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <MessageCircle className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                  <p className="text-muted-foreground text-sm">
                    {conversationSearch ? 'No matches found' : 'No conversations yet'}
                  </p>
                </div>
              ) : (
                filteredConversations.map((conv) => (
                  <button
                    key={conv.otherUser.id}
                    onClick={() => {
                      setSelectedChat(conv.otherUser.id);
                      setActiveProduct(null);
                    }}
                    className={cn(
                      'w-full p-4 flex items-center gap-3 hover:bg-muted transition-colors border-b',
                      selectedChat === conv.otherUser.id && 'bg-muted'
                    )}
                  >
                    <div className="relative">
                      <Avatar>
                        <AvatarImage src={conv.otherUser.avatar_url} />
                        <AvatarFallback>
                          {conv.otherUser.full_name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      {isOnline(conv.otherUser.id) && (
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-background" />
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-medium text-sm truncate">
                        {conv.otherUser.full_name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {conv.content}
                      </p>
                    </div>
                    {conv.is_read === false && conv.sender_id !== user?.id && (
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                    )}
                  </button>
                ))
              )}
            </ScrollArea>
          </Card>

          {/* Chat Area */}
          <Card className="h-[calc(100vh-200px)] flex flex-col">
            {selectedChat && otherUser ? (
              <>
                {/* Chat Header */}
                <CardHeader className="border-b py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="lg:hidden"
                        onClick={() => setSelectedChat(null)}
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                      <Link to={`/user/${otherUser.id}`}>
                        <div className="relative">
                          <Avatar>
                            <AvatarImage src={otherUser.avatar_url} />
                            <AvatarFallback>{otherUser.full_name.charAt(0)}</AvatarFallback>
                          </Avatar>
                          {isOnline(otherUser.id) && (
                            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-background" />
                          )}
                        </div>
                      </Link>
                      <div>
                        <p className="font-medium">{otherUser.full_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {otherTyping
                            ? 'Typing...'
                            : isOnline(otherUser.id)
                              ? 'Online'
                              : otherUser.college_name}
                        </p>
                      </div>
                    </div>
                  </div>
                  {activeProduct && (
                    <Link
                      to={`/product/${activeProduct.id}`}
                      className="mt-2 block text-xs text-blue-500 hover:underline truncate"
                    >
                      Re: {activeProduct.title}
                    </Link>
                  )}
                </CardHeader>

                {/* Messages */}
                <ScrollArea ref={scrollRef} className="flex-1 p-4">
                  <AnimatePresence initial={false}>
                    {messages.map((msg) => (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn(
                          'flex mb-4',
                          msg.sender_id === user?.id ? 'justify-end' : 'justify-start'
                        )}
                      >
                        <div
                          className={cn(
                            'max-w-[70%] rounded-2xl px-4 py-2',
                            msg.sender_id === user?.id
                              ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-br-md'
                              : 'bg-muted rounded-bl-md'
                          )}
                        >
                          <p className="text-sm">{msg.content}</p>
                          <p
                            className={cn(
                              'text-xs mt-1',
                              msg.sender_id === user?.id ? 'text-white/70' : 'text-muted-foreground'
                            )}
                          >
                            {formatTime(msg.created_at)}
                          </p>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {otherTyping && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex mb-4 justify-start"
                    >
                      <div className="max-w-[70%] rounded-2xl rounded-bl-md px-4 py-3 bg-muted flex gap-1 items-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
                      </div>
                    </motion.div>
                  )}
                </ScrollArea>

                {/* Input */}
                <div className="p-4 border-t">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Type a message..."
                      value={newMessage}
                      onChange={(e) => handleMessageInputChange(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="flex-1"
                      disabled={sending}
                    />
                    <Button
                      onClick={sendMessage}
                      disabled={!newMessage.trim() || sending}
                      className="bg-gradient-to-r from-blue-500 to-cyan-500"
                    >
                      {sending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <MessageCircle className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">
                    {conversations.length > 0
                      ? 'Select a conversation to start chatting'
                      : 'Start a conversation by contacting a seller'}
                  </p>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
