'use client';

import { useState } from 'react';
import { FileText, Sparkles, Info, ChevronRight } from 'lucide-react';

interface TextInputProps {
  onSubmit: (text: string) => void;
}

const SAMPLE_RESUME = `Tharun Kalluru
●  in/tharunkalluru        ●  tharunkalluru.com        ●  tharun99.kalluru@gmail.com        ●  (571) 564-8010                                 

EXPERIENCE

AI Product Manager | Contentstack | San Francisco, CA							    Sep 2024 - Present
Built and led the launch of an LLM-powered AI Assistant (used by 60+ enterprises) that cut deployment failures in half.
Streamlined Brand Kit UX (AI native brand automation) with one-click templates, boosting adoption by 40% and resulting in a yearly revenue lift of $1.8M.
Launched Cache Priming (AI-enabled CDN infra) now serving 1.9B+ requests; identified internal champion ideas and drove cross-team alignment to secure leadership buy-in.
Prototyped POCs (MCP + n8n agentic workflows) for a multi-product platform that cut Eng/UX feedback cycles by 3 weeks.
Collaborated with sales and PMM on upselling campaigns that brought in $400K annually from 20+ enterprise customers.
Defined D2C go-to-market roadmap and pricing model that captured $5M+ in untapped growth potential.

Product Manager (Contract) | Teamup | Austin, TX			 				               May 2024 - Aug 2024
Launched a referral campaign loop (codes + drops), growing marketplace signups by 18% and 17K MAU within a month.
Reduced time-to-first-listing by redesigning onboarding UX and the post flow, improving seller activation by 23%.
Introduced in-app chat + ratings, cutting disputes by 33% and lifting repeat purchase rate by 13%.
Developed a growth model (LTV:CAC by channel) to shift spend toward high-return campus channels, lowering CAC by 7%.

Product Analyst | George Mason University | Fairfax, VA       					             	               Aug 2023 - May 2024
Compiled and cleaned a dataset of 400K+ crowdfunding campaigns in Python/SQL, standardizing goals, timelines, categories, and text for reproducible analysis.
Built ML models with LLM text analysis, improving campaign outcome prediction by +9 AUC pts.
Modeled drivers of campaign success (logistic/GBM), translating findings into simple scorecards and dashboards for non-technical stakeholders.

Product Management Associate | Accenture | Hyderabad, India			     			Sep 2021 - Dec 2022
Shipped AI chat bot to fix long Average Handling Time to ~3 minutes/interaction (45% faster) resolution, +23% adoption.
Enhanced platform reliability & observability (idempotency, retries, feature flags, rate limits), achieving ~99% API success across 10+ releases and influencing ~$740K revenue.

UNIVERSITY STARTUPS
Founder, CropsIT - IoT/ML device deployed across 40 farms; +65% yields adding $5K+/farm per season.
Co-founder, Inizio - Helped 15K+ students build resumes (acquired by SNIST).

SKILLS & COMPETENCIES
Technical Fluency: AI/ML, SQL, APIs, Python, JavaScript, GenAI, RAG, MCP, LLMs, MLOps, Evals, A/B Tests, Context Engineering
Tools: Figma, Claude Code, Cursor, Google Analytics, Mixpanel, Heap, n8n, GenAI Tools
Certifications: Aha! PMP, Agile Product Owner, Google UX Design
Documentation: PRDs, BRDs, Jira/Confluence 

EDUCATION
George Mason University, Fairfax, VA 									  Jan 2023 - Dec 2024
Master of Science: Computer Science										  CGPA: 3.83
Selected Coursework: Machine Learning, Artificial Intelligence, Databases, Project Management, Software Testing`;

export default function TextInput({ onSubmit }: TextInputProps) {
  const [text, setText] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit(text);
    }
  };

  const handleLoadSample = () => {
    setText(SAMPLE_RESUME);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey && text.trim()) {
      handleSubmit();
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <FileText className="w-4.5 h-4.5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Paste Your Resume</h2>
            <p className="text-xs text-zinc-500">GPT-generated text works best</p>
          </div>
        </div>
        <button
          onClick={handleLoadSample}
          className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-blue-400 bg-white/5 hover:bg-blue-500/10 border border-white/10 hover:border-blue-500/30 transition-all duration-200"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Try Sample
        </button>
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/10">
        <Info className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-zinc-400 leading-relaxed">
          <span className="text-blue-400 font-medium">Note:</span> Name, contact info, and education are pre-configured and won't change from your input. 
          Only <span className="text-white">EXPERIENCE</span>, <span className="text-white">SKILLS</span>, and <span className="text-white">STARTUPS</span> sections will be parsed.
        </p>
      </div>

      {/* Textarea */}
      <div className={`relative rounded-xl transition-all duration-300 ${isFocused ? 'ring-2 ring-blue-500/50' : ''}`}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={`Paste your resume text here...

Example format:

EXPERIENCE

Product Manager | Company Name | City, State   Jan 2023 - Present
- Achievement with metrics like 40% improvement...
- Another achievement with $5M+ impact...

UNIVERSITY STARTUPS
Founder, Company - Description with metrics...

SKILLS & COMPETENCIES
Technical Skills: Python, SQL, etc.
Tools: Figma, Analytics, etc.`}
          className="w-full h-[340px] bg-black/30 border border-white/10 rounded-xl p-4 text-white text-sm
                     placeholder:text-zinc-600 focus:outline-none resize-none font-mono leading-relaxed
                     scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent"
        />
        {/* Character count */}
        <div className="absolute bottom-3 right-3 text-xs text-zinc-600">
          {text.length > 0 && `${text.length.toLocaleString()} characters`}
        </div>
      </div>

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={!text.trim()}
        className="group relative w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-semibold text-sm
                   disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300
                   bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500
                   text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 hover:scale-[1.01]
                   active:scale-[0.99]"
      >
        <Sparkles className="w-4 h-4" />
        <span>Format Resume</span>
        <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
        {/* Keyboard hint */}
        {text.trim() && (
          <span className="absolute right-4 text-[10px] text-white/50 font-normal hidden sm:block">
            <kbd className="px-1.5 py-0.5 bg-white/10 rounded">⌘</kbd> + <kbd className="px-1.5 py-0.5 bg-white/10 rounded">↵</kbd>
          </span>
        )}
      </button>
    </div>
  );
}
