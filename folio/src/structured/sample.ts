import type { StructuredResume } from './model';

/** A fictional resume and job posting, so a visitor can see a tailoring without uploading anything. */
export const SAMPLE_NAME = 'Sample resume';
export const SAMPLE_RESUME: StructuredResume = {
 "name": "Priya Nair",
 "headline": "Senior Product Manager",
 "contact": [
  "Bengaluru, India",
  "priya.nair@example.com",
  "+91 98765 43210",
  "linkedin.com/in/priyanair-example"
 ],
 "summary": "Product manager with 7 years of experience building B2B SaaS platforms. Led identity, integrations and analytics products from discovery to launch across India and the US.",
 "experience": [
  {
   "title": "Senior Product Manager, Platform",
   "company": "Lumen Cloud",
   "location": "Bengaluru",
   "dates": "Apr 2021 – Present",
   "bullets": [
    {
     "id": "b0_0",
     "text": "Own the roadmap for identity and access management used by 1,200 enterprise customers."
    },
    {
     "id": "b0_1",
     "text": "Launched single sign-on with SAML and OAuth, cutting onboarding time for new customers by 35%."
    },
    {
     "id": "b0_2",
     "text": "Worked with 4 engineering teams to migrate 60 integrations to a new public API."
    },
    {
     "id": "b0_3",
     "text": "Ran weekly customer interviews and turned findings into quarterly priorities."
    },
    {
     "id": "b0_4",
     "text": "Organised the team offsite and maintained the internal wiki."
    },
    {
     "id": "b0_5",
     "text": "Built SQL dashboards to track activation and retention, and used A/B tests to raise activation by 12%."
    }
   ],
   "id": "r0"
  },
  {
   "title": "Product Manager",
   "company": "Kite Analytics",
   "location": "Pune",
   "dates": "Jun 2018 – Mar 2021",
   "bullets": [
    {
     "id": "b1_0",
     "text": "Managed the reporting product for mid-market customers, growing revenue from ₹4 crore to ₹9 crore."
    },
    {
     "id": "b1_1",
     "text": "Defined requirements for a self-serve billing flow with design and finance teams."
    },
    {
     "id": "b1_2",
     "text": "Wrote release notes and trained the support team on new features."
    }
   ],
   "id": "r1"
  },
  {
   "title": "Associate Product Manager",
   "company": "Kite Analytics",
   "location": "Pune",
   "dates": "Jul 2016 – May 2018",
   "bullets": [
    {
     "id": "b2_0",
     "text": "Shipped 15 small improvements to the mobile app based on support tickets."
    }
   ],
   "id": "r2"
  }
 ],
 "education": [
  {
   "degree": "B.Tech, Computer Science",
   "school": "National Institute of Technology",
   "location": "Calicut",
   "dates": "2012 – 2016",
   "details": [
    "CGPA 8.6/10"
   ]
  }
 ],
 "skills": [
  {
   "label": "Product",
   "items": [
    "Roadmapping",
    "Discovery",
    "A/B testing",
    "Pricing"
   ],
   "id": "s0"
  },
  {
   "label": "Technical",
   "items": [
    "SQL",
    "REST APIs",
    "OAuth",
    "SAML",
    "Jira"
   ],
   "id": "s1"
  }
 ],
 "projects": [],
 "extras": [
  {
   "title": "CERTIFICATIONS",
   "items": [
    "Certified Scrum Product Owner (2019)"
   ]
  }
 ]
};
export const SAMPLE_JOB = "Senior Product Manager, Platform at Acme. We are looking for a PM to own identity and access management, SSO, SAML, OAuth, API integrations and our developer platform. Requirements: 5+ years of product management in B2B SaaS, roadmap ownership, stakeholder management, data-driven decision making with SQL and A/B testing. Preferred: experience with enterprise customers, cross-functional leadership, Kubernetes familiarity, agile delivery, and working with design partners on developer experience.";
