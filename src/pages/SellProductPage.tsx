import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { generateProductDescription, getPriceRecommendation } from '@/lib/groq';
import {
  MAX_IMAGES,
  uploadProductImage,
  deleteProductImage,
  type ImageUploadItem,
} from '@/lib/imageUpload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Sparkles,
  Upload,
  Loader2,
  CheckCircle2,
  Coins,
  MapPin,
  Tag,
  FileText,
  ArrowLeft,
  ArrowRight,
  TrendingUp,
  DollarSign,
  X,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';
import type { Category } from '@/types';

const conditions = ['New', 'Like New', 'Good', 'Fair', 'Poor'];

export default function SellProductPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Debug log for user state
  useEffect(() => {
    console.log('[SellProduct] User state:', user ? { id: user.id, email: user.email } : 'null');
  }, [user]);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [condition, setCondition] = useState('Good');
  const [price, setPrice] = useState('');
  const [originalPrice, setOriginalPrice] = useState('');
  const [age, setAge] = useState('0');
  const [location, setLocation] = useState('');
  const [negotiable, setNegotiable] = useState(true);
  const [imageItems, setImageItems] = useState<ImageUploadItem[]>([]);
  const [features, setFeatures] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [aiSummary, setAiSummary] = useState('');

  // UI state
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [priceRecommendation, setPriceRecommendation] = useState<{
    minimumPrice: number;
    recommendedPrice: number;
    maximumPrice: number;
    reason: string;
  } | null>(null);

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    const { data } = await supabase.from('categories').select('*').order('name');
    setCategories(data || []);
  };

  const uploadOneImage = async (item: ImageUploadItem) => {
    if (!user) return;
    setImageItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: 'uploading', error: undefined } : i))
    );
    try {
      const uploadedUrl = await uploadProductImage(item.file, user.id, item.id);

      setImageItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: 'done', uploadedUrl } : i))
      );
    } catch (error) {
      // Log the full error object, not just .message - Supabase storage
      // errors carry a statusCode/name that narrows down bucket-missing vs
      // RLS-denied vs network issues, which a flattened string can hide.
      console.error('[SellProduct] Image upload failed:', error);
      const message = error instanceof Error ? error.message : 'Upload failed';
      setImageItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: 'error', error: message } : i))
      );
      toast({
        title: 'Image upload failed. Please try again.',
        description: message,
        variant: 'destructive',
      });
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!user) {
      toast({ title: 'Sign in required', description: 'Please sign in to upload images.', variant: 'destructive' });
      return;
    }

    const remainingSlots = MAX_IMAGES - imageItems.length;
    if (remainingSlots <= 0) {
      toast({ title: `Maximum ${MAX_IMAGES} images`, variant: 'destructive' });
      e.target.value = '';
      return;
    }

    const filesToAdd = Array.from(files).slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      toast({
        title: `Only ${remainingSlots} more image${remainingSlots === 1 ? '' : 's'} allowed`,
        description: `Maximum ${MAX_IMAGES} images per listing.`,
      });
    }

    const newItems: ImageUploadItem[] = filesToAdd.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading' as const,
    }));

    setImageItems((prev) => [...prev, ...newItems]);
    newItems.forEach((item) => uploadOneImage(item));

    // Allow selecting the same file again later (e.g. after removing it)
    e.target.value = '';
  };

  const retryImageUpload = (id: string) => {
    const item = imageItems.find((i) => i.id === id);
    if (item) uploadOneImage(item);
  };

  const removeImage = async (id: string) => {
    const item = imageItems.find((i) => i.id === id);
    if (!item) return;

    setImageItems((prev) => prev.filter((i) => i.id !== id));
    URL.revokeObjectURL(item.previewUrl);

    // Best-effort cleanup of the uploaded file in Storage - if this fails
    // (e.g. offline) it's an orphaned file, not a broken listing, so we
    // don't block the UI on it.
    if (item.status === 'done' && user) {
      deleteProductImage(user.id, item.id);
    }
  };

  const generateWithAI = async () => {
    if (!title || !category) {
      return;
    }

    setAiGenerating(true);
    try {
      const result = await generateProductDescription(
        title,
        categories.find((c) => c.id === category)?.name || '',
        condition
      );

      setDescription(result.description);
      setFeatures(result.features);
      setTags(result.tags);
      setAiSummary(result.summary);
    } catch (error) {
      console.error('AI generation error:', error);
    } finally {
      setAiGenerating(false);
    }
  };

  const getAiPriceRecommendation = async () => {
    if (!category || !condition || !price) return;

    setPriceLoading(true);
    try {
      const result = await getPriceRecommendation(
        categories.find((c) => c.id === category)?.name || '',
        condition,
        parseInt(age) || 0,
        parseFloat(originalPrice || price) || parseFloat(price),
        'medium'
      );
      setPriceRecommendation(result);
    } catch (error) {
      console.error('Price recommendation error:', error);
    } finally {
      setPriceLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!user || !title || !category || !price || !location) {
      toast({
        title: 'Missing required fields',
        description: 'Please fill in title, category, price, and location.',
        variant: 'destructive',
      });
      return;
    }

    if (imageItems.some((i) => i.status === 'uploading' || i.status === 'compressing')) {
      toast({
        title: 'Images still uploading',
        description: 'Please wait for image uploads to finish before listing.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    const uploadedImageUrls = imageItems
      .filter((i) => i.status === 'done' && i.uploadedUrl)
      .map((i) => i.uploadedUrl!);

    const productData = {
      seller_id: user.id,
      title,
      description: description || null,
      ai_summary: aiSummary || null,
      category_id: category,
      condition,
      price: parseFloat(price),
      original_price: originalPrice ? parseFloat(originalPrice) : null,
      age_months: parseInt(age) || 0,
      location,
      negotiable,
      images: uploadedImageUrls,
      features: features || [],
      tags: tags || [],
      status: 'available',
    };

    try {
      const { data: insertedProduct, error } = await supabase
  .from("products")
  .insert(productData)
  .select()
  .single();

      if (error) {
        console.error('[SellProduct] Insert error:', error);
        toast({ title: 'Could not list product', description: error.message, variant: 'destructive' });
        return;
      }
// Log recent activity
const { data: activityData, error: activityError } = await supabase
  .from("activity_log")
  .insert({
    type: "product_listed",
    actor_id: user.id,
    actor_name: user.full_name || user.email || "Student",
    product_id: insertedProduct.id,
    product_title: insertedProduct.title,
    price: insertedProduct.price,
  })
  .select();

console.log("Activity Data:", activityData);
console.log("Activity Error:", activityError);
      toast({ title: 'Product listed successfully!' });
      navigate('/my-listings');
    } catch (error) {
      console.error('[SellProduct] Submit error:', error);
      toast({
        title: 'Something went wrong',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const canProceedStep1 = title && category && condition;
  const canProceedStep2 = price && location;
  const canSubmit = canProceedStep1 && canProceedStep2;

  return (
    <div className="min-h-screen pb-20 lg:pb-0 py-8">
      <div className="container max-w-4xl px-4">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <h1 className="text-2xl lg:text-3xl font-bold">Sell Your Product</h1>
          <p className="text-muted-foreground">AI will help you create an amazing listing</p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-4 mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex-1">
              <div
                className={`h-2 rounded-full transition-colors ${
                  s <= step ? 'bg-gradient-to-r from-blue-500 to-cyan-500' : 'bg-muted'
                }`}
              />
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="lg:col-span-2">
            <AnimatePresence mode="wait">
              {step === 1 && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                >
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Tag className="h-5 w-5" />
                        Product Details
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="title">Product Title *</Label>
                        <Input
                          id="title"
                          placeholder="e.g., iPhone 13 Pro 256GB"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                        />
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="category">Category *</Label>
                          <Select value={category} onValueChange={setCategory}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                            <SelectContent>
                              {categories.map((cat) => (
                                <SelectItem key={cat.id} value={cat.id}>
                                  {cat.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="condition">Condition *</Label>
                          <Select value={condition} onValueChange={setCondition}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {conditions.map((cond) => (
                                <SelectItem key={cond} value={cond}>
                                  {cond}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="age">How old is the product? (months)</Label>
                        <Input
                          id="age"
                          type="number"
                          placeholder="e.g., 12"
                          value={age}
                          onChange={(e) => setAge(e.target.value)}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Product Images (up to {MAX_IMAGES})</Label>
                        <div className="grid grid-cols-5 gap-2">
                          {imageItems.map((item) => (
                            <div
                              key={item.id}
                              className="relative aspect-square rounded-lg overflow-hidden bg-muted group"
                            >
                              <img
                                src={item.uploadedUrl || item.previewUrl}
                                alt="Product"
                                className={`w-full h-full object-cover ${
                                  item.status !== 'done' ? 'opacity-50' : ''
                                }`}
                              />

                              {(item.status === 'compressing' || item.status === 'uploading') && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30">
                                  <Loader2 className="h-5 w-5 text-white animate-spin" />
                                  <span className="text-[10px] text-white mt-1 capitalize">
                                    {item.status}...
                                  </span>
                                </div>
                              )}

                              {item.status === 'error' && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 gap-1 p-1">
                                  <AlertTriangle className="h-4 w-4 text-red-400" />
                                  <button
                                    type="button"
                                    onClick={() => retryImageUpload(item.id)}
                                    className="flex items-center gap-1 text-[10px] text-white bg-white/20 rounded px-1.5 py-0.5 hover:bg-white/30"
                                  >
                                    <RotateCcw className="h-2.5 w-2.5" /> Retry
                                  </button>
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={() => removeImage(item.id)}
                                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="h-3 w-3" />
                              </button>

                              {item.status === 'done' && (
                                <div className="absolute bottom-1 right-1 bg-green-500 rounded-full p-0.5">
                                  <CheckCircle2 className="h-3 w-3 text-white" />
                                </div>
                              )}
                            </div>
                          ))}
                          {imageItems.length < MAX_IMAGES && (
                            <label className="aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors">
                              <Upload className="h-4 w-4 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground mt-1">Upload</span>
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                multiple
                                className="hidden"
                                onChange={handleImageUpload}
                              />
                            </label>
                          )}
                        </div>
                        {imageItems.some((i) => i.status === 'error') && (
                          <p className="text-xs text-red-500">
                            Some images failed to upload. Tap retry, or remove and try again.
                          </p>
                        )}
                      </div>

                      <Button
                        className="w-full bg-gradient-to-r from-blue-500 to-cyan-500"
                        onClick={() => setStep(2)}
                        disabled={!canProceedStep1}
                      >
                        Continue
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {step === 2 && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                >
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Coins className="h-5 w-5" />
                        Pricing & Location
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="price">Selling Price (₹) *</Label>
                          <Input
                            id="price"
                            type="number"
                            placeholder="e.g., 25000"
                            value={price}
                            onChange={(e) => setPrice(e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="originalPrice">Original Price (₹)</Label>
                          <Input
                            id="originalPrice"
                            type="number"
                            placeholder="e.g., 40000"
                            value={originalPrice}
                            onChange={(e) => setOriginalPrice(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Negotiable?</Label>
                        <div className="flex gap-4">
                          <Button
                            type="button"
                            variant={negotiable ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setNegotiable(true)}
                          >
                            Yes
                          </Button>
                          <Button
                            type="button"
                            variant={!negotiable ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setNegotiable(false)}
                          >
                            Fixed Price
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="location">Location *</Label>
                        <div className="relative">
                          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="location"
                            placeholder="e.g., Hostel Block A, IIT Delhi"
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            className="pl-10"
                          />
                        </div>
                      </div>

                      <Button
                        className="w-full bg-gradient-to-r from-blue-500 to-cyan-500"
                        onClick={() => setStep(3)}
                        disabled={!canProceedStep2}
                      >
                        Generate AI Content
                        <Sparkles className="h-4 w-4 ml-2" />
                      </Button>

                      <Button
                        variant="ghost"
                        className="w-full"
                        onClick={() => setStep(1)}
                      >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {step === 3 && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                >
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        AI-Generated Content
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <Alert className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
                        <Sparkles className="h-4 w-4 text-blue-500" />
                        <AlertDescription>
                          AI will generate a description, features, and tags based on your product details.
                        </AlertDescription>
                      </Alert>

                      <Button
                        className="w-full bg-gradient-to-r from-blue-500 to-cyan-500"
                        onClick={generateWithAI}
                        disabled={aiGenerating}
                      >
                        {aiGenerating ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Sparkles className="h-4 w-4 mr-2" />
                        )}
                        {aiGenerating ? 'Generating...' : 'Generate with AI'}
                      </Button>

                      {description && (
                        <>
                          <div className="space-y-2">
                            <Label>Description</Label>
                            <Textarea
                              value={description}
                              onChange={(e) => setDescription(e.target.value)}
                              rows={4}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Features</Label>
                            <div className="flex flex-wrap gap-2">
                              {features.map((feature, i) => (
                                <Badge key={i} variant="secondary">
                                  {feature}
                                </Badge>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label>Tags</Label>
                            <div className="flex flex-wrap gap-2">
                              {tags.map((tag, i) => (
                                <Badge key={i} variant="outline">
                                  #{tag}
                                </Badge>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label>AI Summary</Label>
                            <p className="text-sm text-muted-foreground bg-muted rounded-lg p-3">
                              {aiSummary}
                            </p>
                          </div>
                        </>
                      )}

                      <Button
                        className="w-full bg-gradient-to-r from-blue-500 to-cyan-500"
                        onClick={handleSubmit}
                        disabled={!canSubmit || loading}
                      >
                        {loading ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                        )}
                        {loading ? 'Listing...' : 'List Product'}
                      </Button>

                      <Button
                        variant="ghost"
                        className="w-full"
                        onClick={() => setStep(2)}
                      >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Sidebar - AI Price Recommendation */}
          <div className="lg:col-span-1">
            <Card className="sticky top-24">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-5 w-5 text-blue-500" />
                  AI Price Advisor
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={getAiPriceRecommendation}
                  disabled={priceLoading || !category || !condition || !price}
                >
                  {priceLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <DollarSign className="h-4 w-4 mr-2" />
                  )}
                  Get Price Recommendation
                </Button>

                {priceRecommendation && (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 rounded-lg bg-red-500/10">
                        <p className="text-xs text-muted-foreground">Min</p>
                        <p className="font-semibold text-red-500">
                          ₹{priceRecommendation.minimumPrice.toLocaleString()}
                        </p>
                      </div>
                      <div className="p-2 rounded-lg bg-blue-500/10">
                        <p className="text-xs text-muted-foreground">Recommended</p>
                        <p className="font-semibold text-blue-500">
                          ₹{priceRecommendation.recommendedPrice.toLocaleString()}
                        </p>
                      </div>
                      <div className="p-2 rounded-lg bg-green-500/10">
                        <p className="text-xs text-muted-foreground">Max</p>
                        <p className="font-semibold text-green-500">
                          ₹{priceRecommendation.maximumPrice.toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {priceRecommendation.reason}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
