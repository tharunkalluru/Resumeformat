'use client';

import { useState } from 'react';
import { FileText, Sparkles } from 'lucide-react';

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

  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit(text);
    }
  };

  const handleLoadSample = () => {
    setText(SAMPLE_RESUME);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-semibold text-white">Paste Your Resume</h2>
        </div>
        <button
          onClick={handleLoadSample}
          className="text-sm text-zinc-400 hover:text-blue-400 transition-colors flex items-center gap-1"
        >
          <Sparkles className="w-4 h-4" />
          Load Sample
        </button>
      </div>
      
      <p className="text-sm text-zinc-400">
        Paste the text from your custom GPT. The app will automatically detect sections like 
        EXPERIENCE, SKILLS, STARTUPS, etc. 
        <br />
        <span className="text-blue-400 font-medium">Note:</span> Name, contact info, and education are constant and won't change.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Paste your resume text here...

NOTE: Name, contact info, and education are hardcoded and won't change.
Only paste EXPERIENCE, SKILLS, and STARTUPS sections.

Example format:

EXPERIENCE

Product Manager | Company Name | City, State   Jan 2023 - Present
- Achievement with metrics...
- Another achievement...

UNIVERSITY STARTUPS
Founder, Company - Description with metrics...

SKILLS & COMPETENCIES
Technical Skills: Python, SQL, etc.
Tools: Figma, Analytics, etc.
...`}
        className="w-full h-[400px] bg-zinc-900 border border-zinc-700 rounded-xl p-4 text-white 
                   placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 
                   focus:border-transparent resize-none font-mono text-sm"
      />

      <button
        onClick={handleSubmit}
        disabled={!text.trim()}
        className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed 
                   flex items-center justify-center gap-2"
      >
        <Sparkles className="w-4 h-4" />
        Format Resume
      </button>
    </div>
  );
}
