import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Sparkles, Lock, ArrowRight, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  // Supabase redirects here with a recovery token in the URL hash. The
  // client picks it up automatically and fires a PASSWORD_RECOVERY auth
  // event once it's parsed - until then we don't know if this is a valid
  // recovery link or someone just landed on this URL directly.
  const [linkValid, setLinkValid] = useState<'checking' | 'valid' | 'invalid'>('checking');
  const navigate = useNavigate();

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setLinkValid('valid');
      }
    });

    // If the recovery event already fired before this listener attached
    // (race on fast page loads), fall back to checking for an active
    // session, since Supabase establishes one from the recovery token.
    const fallbackTimer = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      setLinkValid((current) => (current === 'checking' ? (data.session ? 'valid' : 'invalid') : current));
    }, 1500);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(fallbackTimer);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError(error.message);
      } else {
        setSuccess(true);
        setTimeout(() => navigate('/'), 2000);
      }
    } catch (err) {
      console.error('[ResetPassword] Unexpected error:', err);
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-950 dark:to-blue-950 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center space-x-2">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/25">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <span className="font-bold text-2xl bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
              CampusKart AI
            </span>
          </Link>
        </div>

        <Card className="border-none shadow-2xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl">
          {linkValid === 'checking' ? (
            <CardContent className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-500 mb-4" />
              <p className="text-muted-foreground">Verifying your reset link...</p>
            </CardContent>
          ) : linkValid === 'invalid' ? (
            <CardContent className="text-center py-8">
              <div className="w-16 h-16 mx-auto rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center mb-4">
                <AlertTriangle className="h-8 w-8 text-red-500" />
              </div>
              <h2 className="text-xl font-bold mb-2">Link expired or invalid</h2>
              <p className="text-muted-foreground mb-6">
                Password reset links only work once and expire after a while. Request a new one.
              </p>
              <Link to="/auth/forgot-password">
                <Button className="w-full bg-gradient-to-r from-blue-500 to-cyan-500">
                  Request new link
                </Button>
              </Link>
            </CardContent>
          ) : success ? (
            <CardContent className="text-center py-8">
              <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center mb-4">
                <CheckCircle2 className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-xl font-bold mb-2">Password updated</h2>
              <p className="text-muted-foreground">Taking you back to CampusKart AI...</p>
            </CardContent>
          ) : (
            <>
              <CardHeader className="text-center">
                <CardTitle className="text-2xl">Set a new password</CardTitle>
                <CardDescription>Choose a new password for your account</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="password">New Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10"
                        required
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm New Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="confirmPassword"
                        type="password"
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="pl-10"
                        required
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600"
                    disabled={loading}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Update password
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
