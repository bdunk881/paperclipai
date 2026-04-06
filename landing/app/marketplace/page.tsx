'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Search, Star, Download, Check, X } from 'lucide-react';

const BRAND = {
  colors: {
    primary: '#FF6600',
    dark: '#0F1419',
    blue: '#1A2332',
    gray: '#64748B',
    lightGray: '#F1F5F9',
    white: '#FFFFFF',
    success: '#10B981',
  },
  typography: {
    headline: "'Geist', -apple-system, sans-serif",
    body: "'Inter', -apple-system, sans-serif",
    mono: "'Geist Mono', monospace",
  },
};

const SKILL_PACKS = [
  {
    id: 1,
    name: 'Social Media Manager',
    category: 'Social Media',
    icon: '\u{1F4F1}',
    description: 'Auto-post, schedule, and manage social content across all platforms.',
    price: 'Free',
    rating: 4.8,
    downloads: '2.4K',
    tier: 'Free',
    featured: true,
  },
  {
    id: 2,
    name: 'Customer Support Assistant',
    category: 'Customer Service',
    icon: '\u{1F4AC}',
    description: 'Handle support tickets, respond to inquiries, and track resolutions.',
    price: 'Pro',
    rating: 4.9,
    downloads: '1.8K',
    tier: 'Pro',
    featured: true,
  },
  {
    id: 3,
    name: 'Lead Qualification Engine',
    category: 'Sales',
    icon: '\u{1F3AF}',
    description: 'Score and qualify leads automatically from your CRM.',
    price: 'Enterprise',
    rating: 4.7,
    downloads: '1.2K',
    tier: 'Enterprise',
    featured: true,
  },
  {
    id: 4,
    name: 'Content Amplifier',
    category: 'Content Creation',
    icon: '\u{2728}',
    description: 'Generate, repurpose, and distribute content at scale.',
    price: 'Pro',
    rating: 4.6,
    downloads: '980',
    tier: 'Pro',
  },
  {
    id: 5,
    name: 'Reputation Monitor',
    category: 'Reputation Management',
    icon: '\u{1F50D}',
    description: 'Track mentions, reviews, and brand sentiment across the web.',
    price: 'Free',
    rating: 4.5,
    downloads: '1.5K',
    tier: 'Free',
  },
  {
    id: 6,
    name: 'Operations Optimizer',
    category: 'Operations',
    icon: '\u{2699}\u{FE0F}',
    description: 'Automate workflows and streamline internal processes.',
    price: 'Enterprise',
    rating: 4.8,
    downloads: '890',
    tier: 'Enterprise',
  },
];

function MarketplaceLanding() {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const categories = [
    'All',
    'Social Media',
    'Customer Service',
    'Sales',
    'Content Creation',
    'Reputation Management',
    'Operations',
  ];

  const filteredPacks = SKILL_PACKS.filter((pack) => {
    const matchesCategory = selectedCategory === 'All' || pack.category === selectedCategory;
    const matchesSearch =
      pack.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pack.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div style={{ fontFamily: BRAND.typography.body, color: BRAND.colors.dark }}>
      {/* Header */}
      <header
        style={{
          background: BRAND.colors.white,
          borderBottom: `1px solid ${BRAND.colors.lightGray}`,
          padding: '16px 24px',
        }}
      >
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', fontFamily: BRAND.typography.headline }}>
            AutoFlow <span style={{ color: BRAND.colors.primary }}>Marketplace</span>
          </div>
          <Link href="/" style={{ textDecoration: 'none', color: BRAND.colors.gray, fontSize: '14px' }}>
            &larr; Back to AutoFlow
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section
        style={{
          background: `linear-gradient(135deg, ${BRAND.colors.lightGray} 0%, ${BRAND.colors.white} 100%)`,
          padding: '64px 24px',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <h1 style={{ fontFamily: BRAND.typography.headline, fontSize: '48px', fontWeight: '700', marginBottom: '16px', lineHeight: '1.2' }}>
            Discover Skills & Agents
          </h1>
          <p style={{ fontSize: '18px', color: BRAND.colors.gray, marginBottom: '40px', maxWidth: '600px', margin: '0 auto 40px' }}>
            Extend AutoFlow with pre-built skills and agents. Automate instantly without code.
          </p>

          {/* Search Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: BRAND.colors.white,
              border: `1px solid ${BRAND.colors.lightGray}`,
              borderRadius: '8px',
              padding: '12px 16px',
              maxWidth: '500px',
              margin: '0 auto',
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            }}
          >
            <Search size={18} color={BRAND.colors.gray} />
            <input
              type="text"
              placeholder="Search skills..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                marginLeft: '12px',
                fontFamily: BRAND.typography.body,
                fontSize: '16px',
              }}
            />
          </div>
        </div>
      </section>

      {/* Category Navigation */}
      <section style={{ padding: '32px 24px', borderBottom: `1px solid ${BRAND.colors.lightGray}` }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '20px',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: BRAND.typography.body,
                  fontSize: '14px',
                  fontWeight: '500',
                  background: selectedCategory === cat ? BRAND.colors.primary : BRAND.colors.lightGray,
                  color: selectedCategory === cat ? BRAND.colors.white : BRAND.colors.dark,
                  transition: 'all 0.2s ease',
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Skill Cards Grid */}
      <section style={{ padding: '48px 24px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: '24px',
            }}
          >
            {filteredPacks.map((pack) => (
              <div
                key={pack.id}
                style={{
                  background: BRAND.colors.white,
                  border: `1px solid ${BRAND.colors.lightGray}`,
                  borderRadius: '12px',
                  padding: '24px',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  position: 'relative',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
              >
                {pack.featured && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '12px',
                      right: '12px',
                      background: BRAND.colors.primary,
                      color: BRAND.colors.white,
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                    }}
                  >
                    Featured
                  </div>
                )}

                <div style={{ fontSize: '40px', marginBottom: '12px' }}>{pack.icon}</div>

                <h3 style={{ fontFamily: BRAND.typography.headline, fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>
                  {pack.name}
                </h3>

                <div
                  style={{
                    fontSize: '12px',
                    color: BRAND.colors.primary,
                    fontWeight: '500',
                    marginBottom: '12px',
                  }}
                >
                  {pack.category}
                </div>

                <p style={{ fontSize: '14px', color: BRAND.colors.gray, marginBottom: '16px', lineHeight: '1.5' }}>
                  {pack.description}
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <Star size={16} fill={BRAND.colors.primary} color={BRAND.colors.primary} />
                  <span style={{ fontSize: '14px', fontWeight: '500' }}>{pack.rating}</span>
                  <span style={{ fontSize: '12px', color: BRAND.colors.gray }}>({pack.downloads} installs)</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: '14px', fontWeight: '600' }}>
                    {pack.price === 'Free' ? (
                      <span style={{ color: BRAND.colors.success }}>Free</span>
                    ) : (
                      <span>{pack.price}</span>
                    )}
                  </div>
                  <button
                    style={{
                      background: BRAND.colors.primary,
                      color: BRAND.colors.white,
                      border: 'none',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Download size={14} /> Install
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social Proof Footer */}
      <section
        style={{
          background: BRAND.colors.dark,
          color: BRAND.colors.white,
          padding: '48px 24px',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <h2 style={{ fontFamily: BRAND.typography.headline, fontSize: '32px', fontWeight: '700', marginBottom: '32px' }}>
            Trusted by teams everywhere
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '32px',
              fontSize: '14px',
            }}
          >
            <div>
              <div style={{ fontSize: '32px', fontWeight: '700', color: BRAND.colors.primary }}>15K+</div>
              <div style={{ color: '#94A3B8', marginTop: '8px' }}>Automations running</div>
            </div>
            <div>
              <div style={{ fontSize: '32px', fontWeight: '700', color: BRAND.colors.primary }}>47</div>
              <div style={{ color: '#94A3B8', marginTop: '8px' }}>Skills published</div>
            </div>
            <div>
              <div style={{ fontSize: '32px', fontWeight: '700', color: BRAND.colors.primary }}>4.7*</div>
              <div style={{ color: '#94A3B8', marginTop: '8px' }}>Average rating</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function SkillDetail() {
  const [selectedTab, setSelectedTab] = useState('overview');
  const [selectedTier, setSelectedTier] = useState('Pro');

  const pack = SKILL_PACKS[1];

  const tiers = [
    { name: 'Free', price: 'Free', features: ['Up to 100 tickets/month', 'Basic templates', 'Email support'] },
    { name: 'Pro', price: '$99/mo', features: ['Unlimited tickets', 'Custom templates', 'Priority support', 'Advanced analytics'] },
    { name: 'Enterprise', price: 'Custom', features: ['Everything in Pro', 'Dedicated account', 'Custom integration', 'SLA'] },
  ];

  const agents = [
    { name: 'Support Triage', description: 'Categorizes and routes incoming support requests' },
    { name: 'Response Generator', description: 'Drafts contextual responses based on ticket content' },
    { name: 'Resolution Tracker', description: 'Monitors ticket progress and escalates when needed' },
  ];

  return (
    <div style={{ fontFamily: BRAND.typography.body, color: BRAND.colors.dark, background: BRAND.colors.white }}>
      {/* Header */}
      <header
        style={{
          background: BRAND.colors.white,
          borderBottom: `1px solid ${BRAND.colors.lightGray}`,
          padding: '16px 24px',
        }}
      >
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <a href="/marketplace" style={{ textDecoration: 'none', color: BRAND.colors.gray }}>
            &larr; Marketplace
          </a>
          <span style={{ color: BRAND.colors.lightGray }}>/</span>
          <span>{pack.name}</span>
        </div>
      </header>

      {/* Hero Section */}
      <section style={{ padding: '48px 24px', background: `linear-gradient(135deg, ${BRAND.colors.lightGray}, ${BRAND.colors.white})` }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '48px', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '80px', marginBottom: '24px' }}>{pack.icon}</div>
            <h1 style={{ fontFamily: BRAND.typography.headline, fontSize: '44px', fontWeight: '700', marginBottom: '12px' }}>
              {pack.name}
            </h1>
            <div style={{ fontSize: '12px', color: BRAND.colors.primary, fontWeight: '600', textTransform: 'uppercase', marginBottom: '24px' }}>
              {pack.category}
            </div>
            <p style={{ fontSize: '18px', color: BRAND.colors.gray, lineHeight: '1.6' }}>
              Handle support tickets automatically with AI-powered responses. Reduce response time, improve customer satisfaction, and free up your team.
            </p>
          </div>

          {/* Sidebar Stats */}
          <div>
            <div style={{ background: BRAND.colors.white, borderRadius: '12px', padding: '32px', border: `1px solid ${BRAND.colors.lightGray}` }}>
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '32px', fontWeight: '700', color: BRAND.colors.primary }}>4.9*</div>
                <div style={{ fontSize: '14px', color: BRAND.colors.gray, marginTop: '8px' }}>1,847 reviews</div>
              </div>

              <div style={{ marginBottom: '24px', paddingBottom: '24px', borderBottom: `1px solid ${BRAND.colors.lightGray}` }}>
                <div style={{ fontSize: '14px', color: BRAND.colors.gray, marginBottom: '4px' }}>Active Installs</div>
                <div style={{ fontSize: '28px', fontWeight: '700' }}>1.8K</div>
              </div>

              <button
                style={{
                  width: '100%',
                  background: BRAND.colors.primary,
                  color: BRAND.colors.white,
                  border: 'none',
                  borderRadius: '8px',
                  padding: '16px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                <Download size={18} /> Install Now
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <section style={{ borderBottom: `1px solid ${BRAND.colors.lightGray}`, padding: '0 24px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', gap: '32px' }}>
          {['overview', 'agents', 'reviews', 'what-included'].map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab)}
              style={{
                padding: '16px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontFamily: BRAND.typography.body,
                fontSize: '14px',
                fontWeight: '500',
                borderBottom: selectedTab === tab ? `3px solid ${BRAND.colors.primary}` : 'none',
                color: selectedTab === tab ? BRAND.colors.dark : BRAND.colors.gray,
                textTransform: 'capitalize',
              }}
            >
              {tab.replace('-', ' ')}
            </button>
          ))}
        </div>
      </section>

      {/* Tab Content */}
      <section style={{ padding: '48px 24px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          {selectedTab === 'overview' && (
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '48px' }}>
              <div>
                <h2 style={{ fontFamily: BRAND.typography.headline, fontSize: '24px', fontWeight: '700', marginBottom: '24px' }}>
                  Key Features
                </h2>
                <div style={{ display: 'grid', gap: '24px' }}>
                  {[
                    { title: 'Smart Triage', desc: 'Automatically categorize tickets by urgency and topic' },
                    { title: 'AI Responses', desc: 'Generate contextual responses that sound human' },
                    { title: 'Integration Ready', desc: 'Works with Zendesk, Intercom, Helpdesk, and more' },
                    { title: 'Analytics Dashboard', desc: 'Track resolution time, satisfaction, and performance' },
                  ].map((feature, i) => (
                    <div key={i}>
                      <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px' }}>{feature.title}</h3>
                      <p style={{ fontSize: '14px', color: BRAND.colors.gray }}>{feature.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h2 style={{ fontFamily: BRAND.typography.headline, fontSize: '24px', fontWeight: '700', marginBottom: '24px' }}>
                  Requirements
                </h2>
                <div style={{ background: BRAND.colors.lightGray, borderRadius: '8px', padding: '16px', fontSize: '14px' }}>
                  <div style={{ marginBottom: '12px' }}>
                    <strong>Minimum tier:</strong> Pro
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <strong>Supported platforms:</strong> Zendesk, Intercom, Help Scout, Freshdesk
                  </div>
                  <div>
                    <strong>Setup time:</strong> &lt;5 minutes
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedTab === 'agents' && (
            <div>
              <h2 style={{ fontFamily: BRAND.typography.headline, fontSize: '24px', fontWeight: '700', marginBottom: '24px' }}>
                Included Agents
              </h2>
              <div style={{ display: 'grid', gap: '24px' }}>
                {agents.map((agent, i) => (
                  <div
                    key={i}
                    style={{
                      background: BRAND.colors.white,
                      border: `1px solid ${BRAND.colors.lightGray}`,
                      borderRadius: '8px',
                      padding: '20px',
                    }}
                  >
                    <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px' }}>{agent.name}</h3>
                    <p style={{ fontSize: '14px', color: BRAND.colors.gray }}>{agent.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedTab === 'reviews' && (
            <div>
              <h2 style={{ fontFamily: BRAND.typography.headline, fontSize: '24px', fontWeight: '700', marginBottom: '24px' }}>
                Customer Reviews
              </h2>
              <div style={{ display: 'grid', gap: '16px' }}>
                {['Reduced support backlog by 60%', 'Easy setup, immediate impact', 'Game changer for our team'].map((review, i) => (
                  <div key={i} style={{ background: BRAND.colors.lightGray, borderRadius: '8px', padding: '16px' }}>
                    <div style={{ marginBottom: '8px' }}>
                      {'\u2B50'.repeat(5)}
                    </div>
                    <p style={{ fontSize: '14px' }}>{review}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedTab === 'what-included' && (
            <div>
              <h2 style={{ fontFamily: BRAND.typography.headline, fontSize: '24px', fontWeight: '700', marginBottom: '24px' }}>
                What&apos;s Included
              </h2>
              <div style={{ display: 'grid', gap: '12px' }}>
                {['AI-powered ticket analysis', 'Multi-channel support', 'Custom response templates', 'Performance analytics'].map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}>
                    <Check size={18} color={BRAND.colors.success} />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Pricing Section */}
      <section style={{ background: BRAND.colors.lightGray, padding: '48px 24px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <h2 style={{ fontFamily: BRAND.typography.headline, fontSize: '32px', fontWeight: '700', marginBottom: '8px', textAlign: 'center' }}>
            Simple Pricing
          </h2>
          <p style={{ textAlign: 'center', color: BRAND.colors.gray, marginBottom: '40px' }}>
            Pick the plan that works for your team
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
            {tiers.map((tier) => (
              <div
                key={tier.name}
                style={{
                  background: BRAND.colors.white,
                  borderRadius: '12px',
                  padding: '32px',
                  border: selectedTier === tier.name ? `2px solid ${BRAND.colors.primary}` : `1px solid ${BRAND.colors.lightGray}`,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onClick={() => setSelectedTier(tier.name)}
              >
                <h3 style={{ fontFamily: BRAND.typography.headline, fontSize: '18px', fontWeight: '600', marginBottom: '12px' }}>
                  {tier.name}
                </h3>
                <div style={{ fontSize: '28px', fontWeight: '700', marginBottom: '24px' }}>
                  {tier.price}
                </div>
                <button
                  style={{
                    width: '100%',
                    background: selectedTier === tier.name ? BRAND.colors.primary : BRAND.colors.lightGray,
                    color: selectedTier === tier.name ? BRAND.colors.white : BRAND.colors.dark,
                    border: 'none',
                    borderRadius: '8px',
                    padding: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    marginBottom: '24px',
                    transition: 'all 0.2s ease',
                  }}
                >
                  Choose {tier.name}
                </button>
                <div style={{ display: 'grid', gap: '12px' }}>
                  {tier.features.map((feature, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                      <Check size={16} color={BRAND.colors.success} />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function TierComparison() {
  return (
    <div style={{ fontFamily: BRAND.typography.body, color: BRAND.colors.dark, padding: '48px 24px', background: BRAND.colors.white }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <h1 style={{ fontFamily: BRAND.typography.headline, fontSize: '40px', fontWeight: '700', marginBottom: '48px', textAlign: 'center' }}>
          Choose Your Plan
        </h1>

        <div style={{ overflowX: 'auto', marginBottom: '48px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${BRAND.colors.lightGray}` }}>
                <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600', fontSize: '14px' }}>Feature</th>
                <th style={{ textAlign: 'center', padding: '16px', fontWeight: '600', fontSize: '14px' }}>Free</th>
                <th style={{ textAlign: 'center', padding: '16px', fontWeight: '600', fontSize: '14px' }}>Pro</th>
                <th style={{ textAlign: 'center', padding: '16px', fontWeight: '600', fontSize: '14px' }}>Enterprise</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Skills Available', free: '20+', pro: 'All', enterprise: 'All' },
                { name: 'Monthly Executions', free: '1K', pro: 'Unlimited', enterprise: 'Unlimited' },
                { name: 'Custom Integration', free: false, pro: true, enterprise: true },
                { name: 'Priority Support', free: false, pro: true, enterprise: true },
                { name: 'Advanced Analytics', free: false, pro: true, enterprise: true },
                { name: 'Dedicated Account Manager', free: false, pro: false, enterprise: true },
                { name: 'SLA', free: false, pro: false, enterprise: true },
              ].map((row, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${BRAND.colors.lightGray}` }}>
                  <td style={{ padding: '16px', fontSize: '14px' }}>{row.name}</td>
                  <td style={{ padding: '16px', textAlign: 'center' }}>
                    {typeof row.free === 'boolean' ? (
                      row.free ? (
                        <Check size={18} color={BRAND.colors.success} style={{ margin: '0 auto' }} />
                      ) : (
                        <X size={18} color={BRAND.colors.gray} style={{ margin: '0 auto' }} />
                      )
                    ) : (
                      <span style={{ fontSize: '14px', fontWeight: '500' }}>{row.free}</span>
                    )}
                  </td>
                  <td style={{ padding: '16px', textAlign: 'center' }}>
                    {typeof row.pro === 'boolean' ? (
                      row.pro ? (
                        <Check size={18} color={BRAND.colors.success} style={{ margin: '0 auto' }} />
                      ) : (
                        <X size={18} color={BRAND.colors.gray} style={{ margin: '0 auto' }} />
                      )
                    ) : (
                      <span style={{ fontSize: '14px', fontWeight: '500' }}>{row.pro}</span>
                    )}
                  </td>
                  <td style={{ padding: '16px', textAlign: 'center' }}>
                    {typeof row.enterprise === 'boolean' ? (
                      row.enterprise ? (
                        <Check size={18} color={BRAND.colors.success} style={{ margin: '0 auto' }} />
                      ) : (
                        <X size={18} color={BRAND.colors.gray} style={{ margin: '0 auto' }} />
                      )
                    ) : (
                      <span style={{ fontSize: '14px', fontWeight: '500' }}>{row.enterprise}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* CTA Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
          {[
            { name: 'Free', price: 'Free forever', cta: 'Get Started', highlight: false },
            { name: 'Pro', price: '$99/month', cta: 'Start Free Trial', highlight: true },
            { name: 'Enterprise', price: 'Custom pricing', cta: 'Contact Sales', highlight: false },
          ].map((plan) => (
            <div
              key={plan.name}
              style={{
                background: plan.highlight ? BRAND.colors.primary : BRAND.colors.white,
                color: plan.highlight ? BRAND.colors.white : BRAND.colors.dark,
                borderRadius: '12px',
                padding: '32px',
                border: plan.highlight ? 'none' : `1px solid ${BRAND.colors.lightGray}`,
                textAlign: 'center',
              }}
            >
              <h3 style={{ fontFamily: BRAND.typography.headline, fontSize: '20px', fontWeight: '600', marginBottom: '8px' }}>
                {plan.name}
              </h3>
              <div style={{ fontSize: '28px', fontWeight: '700', marginBottom: '24px' }}>
                {plan.price}
              </div>
              <button
                style={{
                  width: '100%',
                  background: plan.highlight ? BRAND.colors.white : BRAND.colors.primary,
                  color: plan.highlight ? BRAND.colors.primary : BRAND.colors.white,
                  border: 'none',
                  borderRadius: '8px',
                  padding: '12px 24px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function MarketplacePage() {
  const [currentPage, setCurrentPage] = useState('landing');

  return (
    <div>
      {/* Page Navigation */}
      <div style={{ background: BRAND.colors.dark, color: BRAND.colors.white, padding: '16px', textAlign: 'center' }}>
        <div style={{ display: 'flex', gap: '24px', justifyContent: 'center', fontFamily: BRAND.typography.body }}>
          <button
            onClick={() => setCurrentPage('landing')}
            style={{
              background: currentPage === 'landing' ? BRAND.colors.primary : 'transparent',
              color: BRAND.colors.white,
              border: 'none',
              padding: '8px 16px',
              cursor: 'pointer',
              borderRadius: '4px',
              fontWeight: '500',
            }}
          >
            Marketplace Landing
          </button>
          <button
            onClick={() => setCurrentPage('detail')}
            style={{
              background: currentPage === 'detail' ? BRAND.colors.primary : 'transparent',
              color: BRAND.colors.white,
              border: 'none',
              padding: '8px 16px',
              cursor: 'pointer',
              borderRadius: '4px',
              fontWeight: '500',
            }}
          >
            Skill Detail
          </button>
          <button
            onClick={() => setCurrentPage('pricing')}
            style={{
              background: currentPage === 'pricing' ? BRAND.colors.primary : 'transparent',
              color: BRAND.colors.white,
              border: 'none',
              padding: '8px 16px',
              cursor: 'pointer',
              borderRadius: '4px',
              fontWeight: '500',
            }}
          >
            Tier Comparison
          </button>
        </div>
      </div>

      {/* Page Content */}
      {currentPage === 'landing' && <MarketplaceLanding />}
      {currentPage === 'detail' && <SkillDetail />}
      {currentPage === 'pricing' && <TierComparison />}
    </div>
  );
}
