# 🛒 CampusKart AI

### AI-Powered Student-to-Student Marketplace

CampusKart AI is a student-focused marketplace that allows college students to **buy, sell, discover, save, and communicate about products within a simple and modern platform**.

The project combines a marketplace experience with **AI-powered product pricing, AI-generated descriptions, and intelligent search assistance**.

🔗 **Live Demo:** https://campus-market-place-ai.vercel.app/
💻 **GitHub:** https://github.com/saranyapapatla23/Campus-MarketPlace-AI

---

## 🎥 Feature Demonstrations

The project is demonstrated through short videos covering the major features.

### 1. 🔐 Create Account

Demonstrates:

* Creating a new account
* Entering student details
* College information
* Account registration

🎬 **Demo Video:** `Add your Create Account video link here`

---

### 2. 🔑 Sign In

Demonstrates:

* Signing in with an existing account
* Authentication
* Redirecting to the marketplace after successful login

🎬 **Demo Video:** `Add your Sign In video link here`

---

### 3. 🏷️ Sell Product + AI Tools + Recent Activity

Demonstrates the complete seller workflow:

* Creating a product listing
* Selecting category and condition
* Entering product age
* Uploading product images
* **AI Price Advisor**
* **AI Product Description Generator**
* Listing the product
* Product appearing in **Recent Activity**

🎬 **Demo Video:** `Add your Sell Product video link here`

---

### 4. 🏪 Marketplace Browsing

Demonstrates:

* Browsing available products
* Searching products
* Category filtering
* Condition filtering
* Minimum price filtering
* Maximum price filtering
* Switching between different product viewing layouts

Available conditions:

`New` · `Like New` · `Good` · `Fair` · `Poor`

🎬 **Demo Video:** `Add your Marketplace Browsing video link here`

---

### 5. ❤️ Wishlist

Students can save products they are interested in and access them later from the Wishlist section.

Demonstrates:

* Saving a product
* Removing a saved product
* Opening the Wishlist
* Viewing saved products

🎬 **Demo Video:** `Add your Wishlist video link here`

---

### 6. 💬 Buyer-Seller Chat

CampusKart AI provides in-platform communication between buyers and sellers.

Demonstrates:

* Opening a product
* Clicking **Contact Seller**
* Sending messages
* Viewing the conversation
* Communicating about a product

🎬 **Demo Video:** `Add your Chat video link here`

---

### 7. 👤 Profile, Listings, Orders & Settings

A complete demonstration of the user's account dashboard.

Includes:

* 🌙 Night Mode / ☀️ Light Mode
* 👤 My Profile
* 🏷️ My Listings
* 📦 Orders
* ⚙️ Settings
* 🚪 Sign Out

🎬 **Demo Video:** `Add your Profile & Account Features video link here`

---

# ✨ Key Features

## 🔐 Authentication

* Student account creation
* Secure sign in
* User profiles
* College information
* Verified college-student profile display

---

## 🏪 Marketplace

Students can browse products listed by other students.

Each product listing displays:

* Product image
* Product title
* Category
* Condition
* Current price
* Original price
* Negotiable status
* Seller name
* Seller college
* Listing time
* Views
* Saved count
* AI-generated summary
* Description
* Key features
* Searchable tags
* Reviews

Example:

> **Etude Mini Matte Tint**
> New · Negotiable · Clothing
> ₹450 ~~₹650~~
> Seller: Rajeshwari · IIT Bombay

---

# 🤖 AI Features

## 💰 AI Price Advisor

Helps sellers determine a reasonable second-hand selling price.

The recommendation considers:

* Product category
* Product condition
* Product age
* Original price
* Current demand

The system provides:

* Minimum price
* Recommended price
* Maximum price
* Explanation for the recommendation

---

## ✍️ AI Product Description Generator

Sellers can generate a complete product listing using AI.

The generated content includes:

* Catchy product title
* Detailed description
* 5 key features
* 5 searchable tags
* Short AI summary

This reduces the effort required to create attractive product listings.

---

## 🔎 AI-Powered Search

Users can search products using natural language.

The AI can interpret search intent and convert it into structured marketplace filters such as:

* Category
* Minimum price
* Maximum price
* Condition
* Sorting preference
* Search keywords

---

## 🤝 CampusKart AI Assistant

The marketplace also includes an AI assistant that can help students:

* Find products
* Understand marketplace options
* Get product suggestions
* Navigate marketplace features
* Receive personalized recommendations

---

# 🛍️ Creating a Product Listing

A seller can create a listing by providing:

1. Product Title
2. Category
3. Condition
4. Product Age
5. Product Images
6. Price information

The seller can then use:

**AI Price Advisor → AI Description Generator → List Product**

Once the product is listed, it becomes available in the marketplace.

---

# ⚡ Recent Activity

CampusKart AI keeps track of marketplace activity.

For example:

> 🟢 Rajeshwari listed **"Etude Mini Matte Tint"** for **₹450**
> 17 minutes ago

This allows users to see recent marketplace activity.

---

# ❤️ Wishlist

Users can save products they are interested in.

The Wishlist provides a dedicated place to:

* View saved products
* Revisit products later
* Remove products from the wishlist

---

# 💬 Messaging

Buyers can contact sellers directly through the platform.

The messaging system allows users to:

* Start conversations
* Send messages
* View previous conversations
* Discuss products before purchasing

---

# 👤 User Profile

Each seller has a profile containing information such as:

* Name
* College
* College verification status
* Listed products
* Reviews

This helps buyers understand who they are purchasing from.

---

# 🌙 Dark & Light Mode

CampusKart AI supports both:

* ☀️ Light Mode
* 🌙 Dark Mode

Users can switch between themes according to their preference.

---

# 🧰 Tech Stack

### Frontend

* React
* TypeScript
* Vite
* Tailwind CSS
* shadcn/ui
* Framer Motion

### Backend / Database

* Supabase
* PostgreSQL
* Supabase Authentication
* Supabase Storage
* Supabase Realtime

### AI

* Groq API
* OpenAI-compatible API interface
* `openai/gpt-oss-120b`

### Deployment

* Vercel

---

# 🏗️ System Architecture

```text
                    ┌─────────────────────┐
                    │      Student        │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   React + TypeScript│
                    │      Frontend       │
                    └──────────┬──────────┘
                               │
                ┌──────────────┼──────────────┐
                │              │              │
                ▼              ▼              ▼
        ┌──────────────┐ ┌────────────┐ ┌──────────────┐
        │   Supabase   │ │  Groq AI   │ │   Storage    │
        │ Auth + DB    │ │   Models   │ │   Images     │
        └──────────────┘ └────────────┘ └──────────────┘
                │              │
                ▼              ▼
        ┌─────────────────────────────────┐
        │       CampusKart AI             │
        │                                 │
        │ Marketplace • Wishlist • Chat   │
        │ AI Pricing • AI Descriptions    │
        │ Search • Profiles • Reviews     │
        └─────────────────────────────────┘
```

---

# 🗄️ Main Data Components

The application uses Supabase/PostgreSQL to manage marketplace data including:

* Users
* Products
* Wishlists
* Reviews
* Messages
* Recent activity
* User profiles
* Product images

Supabase Storage is used for product image storage.

---

# 🚀 Getting Started

## 1. Clone the Repository

```bash
git clone https://github.com/saranyapapatla23/Campus-MarketPlace-AI.git
```

```bash
cd Campus-MarketPlace-AI
```

## 2. Install Dependencies

```bash
npm install
```

## 3. Configure Environment Variables

Create a `.env` file in the project root.

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_GROQ_API_KEY=your_groq_api_key
```

## 4. Start the Development Server

```bash
npm run dev
```

The application will be available at the local development URL provided by Vite.

---

# 📸 Project Highlights

The application includes:

* 🔐 Authentication
* 🏪 Marketplace
* 🔎 Product Search
* 🎯 Advanced Filters
* ❤️ Wishlist
* 🤖 AI Price Advisor
* ✍️ AI Description Generator
* 💬 Buyer-Seller Messaging
* 👤 User Profiles
* ⭐ Reviews
* ⚡ Recent Activity
* 🌙 Dark Mode
* 📦 Orders
* ⚙️ Settings

---

# 🎯 Problem Statement

Students frequently have unused products such as:

* Books
* Electronics
* Clothing
* Furniture
* Appliances
* Sports equipment
* Hostel essentials

General marketplaces are not specifically designed around student needs.

CampusKart AI aims to provide a **student-oriented marketplace where students can easily discover, sell, save, and communicate about products**, while AI assists sellers in creating better listings and setting reasonable prices.

---

# 🔮 Future Improvements

Potential future enhancements include:

* 💳 Integrated payment system
* 📍 Campus/location-based product discovery
* 🔔 Push notifications
* 📦 Complete order management
* 🤖 More advanced personalized recommendations
* 📊 Seller analytics dashboard
* 🛡️ Enhanced moderation and fraud detection
* 📱 Progressive Web App / mobile application

---

# 👩‍💻 Author

**Saranya Papatla**

B.Tech — Electronics & Communication Engineering
IIIT Allahabad

### Project

**CampusKart AI — AI-Powered Student Marketplace**

---

## ⭐ If you find this project interesting

Consider giving the repository a ⭐ on GitHub!


