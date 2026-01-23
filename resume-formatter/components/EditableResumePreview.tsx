'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ParsedResume } from '@/lib/parser';
import { boldMetrics, stripHtml } from '@/lib/formatMetrics';

interface EditableResumePreviewProps {
  parsedResume: ParsedResume;
  onResumeChange: (updated: ParsedResume) => void;
}

/**
 * DYNAMIC RESUME LAYOUT ALGORITHM
 * 
 * This algorithm ensures ANY resume content fits perfectly on ONE page with uniform borders.
 * 
 * How it works:
 * 1. MEASURE: Calculate actual content height without constraints
 * 2. COMPARE: Calculate ratio of available space to content height
 * 3. ADJUST:
 *    - TOO LONG (ratio < 0.98): Shrink font down to 80% minimum
 *    - TOO SHORT (ratio > 1.03): Distribute extra space intelligently
 *    - VERY SHORT (ratio > 1.20): Also expand font up to 110%
 *    - PERFECT FIT (0.98-1.03): No adjustments needed
 * 
 * Spacing distribution is adaptive based on content structure:
 * - More sections → more section gaps
 * - More bullets → more bullet gaps
 * - Balanced across all elements
 * aa
 * Result: Uniform borders, one page, consistent formatting for ANY content length
 */

// Page dimensions at 96 DPI
const PAGE_HEIGHT_PX = 11 * 96; // 1056px
const PADDING_TOP = 0.38 * 96; // ~36.5px
const PADDING_BOTTOM = 0.38 * 96; // ~36.5px
const USABLE_HEIGHT = PAGE_HEIGHT_PX - PADDING_TOP - PADDING_BOTTOM; // ~983px

// Base spacing (minimum values)
const BASE_SECTION_GAP = 12;
const BASE_JOB_GAP = 10;
const BASE_BULLET_GAP = 3;

// Maximum spacing (generous for short content, but safe)
const MAX_SECTION_GAP = 24;
const MAX_JOB_GAP = 18;
const MAX_BULLET_GAP = 6;

// Font scale limits - more aggressive to fill the page
const MIN_FONT_SCALE = 0.85; // Can shrink to 85% for very long content
const MAX_FONT_SCALE = 1.15; // Can expand to 115% for short content

// Target: Fill 98-100% of the page (leave tiny margin for safety)
const TARGET_FILL_RATIO = 0.98;

// Constant contact information - never changes
const CONSTANT_CONTACT = {
  name: 'Tharun Kalluru',
  linkedin: 'in/tharunkalluru',
  linkedinUrl: 'https://www.linkedin.com/in/tharunkalluru/',
  portfolio: 'tharunkalluru.com',
  portfolioUrl: 'https://www.tharunkalluru.com/',
  email: 'tharunkalluru99@gmail.com',
  phone: '5715648010'
};

// Constant education information - never changes
const CONSTANT_EDUCATION = {
  school: 'George Mason University',
  location: 'Fairfax, VA',
  dateRange: 'Jan 2023 - Dec 2024',
  degree: 'Master of Science: Computer Science',
  gpa: '3.83',
  coursework: 'Machine Learning, Artificial Intelligence, Databases, Project Management, Software Testing'
};

// Editable text component
function EditableText({ 
  value, 
  onChange, 
  className = '',
  applyBoldMetrics = false,
}: { 
  value: string; 
  onChange: (val: string) => void; 
  className?: string;
  applyBoldMetrics?: boolean;
}) {
  const handleBlur = (e: React.FocusEvent<HTMLSpanElement>) => {
    const newValue = e.currentTarget.innerText;
    if (newValue !== stripHtml(value)) {
      onChange(newValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
  };

  const displayValue = applyBoldMetrics ? boldMetrics(value) : value;

  return (
    <span
      contentEditable
      suppressContentEditableWarning
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={`editable-field ${className}`}
      dangerouslySetInnerHTML={{ __html: displayValue || 'Click to edit...' }}
    />
  );
}

// Editable bullet list
function EditableBulletList({
  bullets,
  onChange,
}: {
  bullets: string[];
  onChange: (bullets: string[]) => void;
}) {
  const handleBulletChange = (index: number, newValue: string) => {
    const updated = [...bullets];
    if (newValue.trim() === '' && bullets.length > 1) {
      updated.splice(index, 1);
    } else {
      updated[index] = newValue;
    }
    onChange(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const updated = [...bullets];
      updated.splice(index + 1, 0, '');
      onChange(updated);
      setTimeout(() => {
        const list = (e.target as HTMLElement).closest('ul');
        const items = list?.querySelectorAll('li .editable-field');
        (items?.[index + 1] as HTMLElement)?.focus();
      }, 10);
    } else if (e.key === 'Backspace' && (e.target as HTMLElement).innerText === '' && bullets.length > 1) {
      e.preventDefault();
      const updated = [...bullets];
      updated.splice(index, 1);
      onChange(updated);
    }
  };

  return (
    <ul className="resume-bullets">
      {bullets.map((bullet, index) => (
        <li key={index}>
          <span
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => handleBulletChange(index, e.currentTarget.innerText)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className="editable-field"
            dangerouslySetInnerHTML={{ __html: boldMetrics(bullet) }}
          />
        </li>
      ))}
    </ul>
  );
}

export default function EditableResumePreview({ parsedResume, onResumeChange }: EditableResumePreviewProps) {
  const [resume, setResume] = useState(parsedResume);
  const resumeRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setResume(parsedResume);
  }, [parsedResume]);

  // Measure TRUE content height by temporarily removing constraints
  const measureContentHeight = useCallback((element: HTMLElement): number => {
    // Store original styles
    const originalHeight = element.style.height;
    const originalMaxHeight = element.style.maxHeight;
    const originalOverflow = element.style.overflow;
    
    // Remove constraints to measure true content
    element.style.height = 'auto';
    element.style.maxHeight = 'none';
    element.style.overflow = 'visible';
    
    // Force reflow and measure
    const contentHeight = element.scrollHeight;
    
    // Restore original styles
    element.style.height = originalHeight;
    element.style.maxHeight = originalMaxHeight;
    element.style.overflow = originalOverflow;
    
    return contentHeight;
  }, []);

  // Dynamic spacing calculation - SMART algorithm to fill page exactly
  const calculateAndApplySpacing = useCallback(() => {
    if (!resumeRef.current) return;

    const element = resumeRef.current;
    
    // Reset to base state first
    element.style.fontSize = '9pt'; // Base font size
    element.style.setProperty('--section-gap', `${BASE_SECTION_GAP}px`);
    element.style.setProperty('--job-gap', `${BASE_JOB_GAP}px`);
    element.style.setProperty('--bullet-gap', `${BASE_BULLET_GAP}px`);

    // Wait for reflow
    requestAnimationFrame(() => {
      // Measure TRUE content height (without container constraints)
      const rawContentHeight = measureContentHeight(element);
      const contentHeight = rawContentHeight - PADDING_TOP - PADDING_BOTTOM;
      
      // Count elements for distribution
      const sections = element.querySelectorAll('.resume-section');
      const jobEntries = element.querySelectorAll('.job-entry');
      const bullets = element.querySelectorAll('.resume-bullets li');
      
      const sectionCount = sections.length;
      const jobCount = jobEntries.length;
      const bulletCount = bullets.length;

      console.log('=== Smart Page Fill Algorithm ===');
      console.log('Content Height:', contentHeight.toFixed(0), 'px');
      console.log('Usable Height:', USABLE_HEIGHT.toFixed(0), 'px');
      console.log('Gap:', (USABLE_HEIGHT - contentHeight).toFixed(0), 'px');

      // Calculate how much we need to scale to fill the page
      const fillRatio = USABLE_HEIGHT / contentHeight;
      console.log('Fill Ratio:', fillRatio.toFixed(3));

      // STRATEGY: First try to fill with font scaling, then fine-tune with spacing
      let fontScale = 1.0;
      let finalSectionGap = BASE_SECTION_GAP;
      let finalJobGap = BASE_JOB_GAP;
      let finalBulletGap = BASE_BULLET_GAP;

      if (fillRatio < 1.0) {
        // Content is TOO LARGE - shrink font
        fontScale = Math.max(MIN_FONT_SCALE, fillRatio * 0.98);
        console.log('📉 Shrinking font to:', fontScale.toFixed(3));
        
      } else if (fillRatio > 1.02) {
        // Content is too small - EXPAND to fill page
        
        // First, calculate ideal font scale to fill ~95% of space (leave room for spacing)
        const targetFontScale = Math.min(MAX_FONT_SCALE, fillRatio * 0.96);
        fontScale = targetFontScale;
        console.log('📈 Expanding font to:', fontScale.toFixed(3));
        
        // After font scaling, calculate remaining space for spacing distribution
        const scaledContentHeight = contentHeight * fontScale;
        const remainingSpace = USABLE_HEIGHT - scaledContentHeight;
        
        if (remainingSpace > 10) {
          // Distribute remaining space intelligently
          const totalGapElements = sectionCount + jobCount;
          
          if (totalGapElements > 0) {
            // Prioritize section gaps (they're more visible)
            const spacePerSection = sectionCount > 0 ? remainingSpace * 0.6 / sectionCount : 0;
            const spacePerJob = jobCount > 0 ? remainingSpace * 0.4 / jobCount : 0;
            
            finalSectionGap = Math.min(BASE_SECTION_GAP + spacePerSection, MAX_SECTION_GAP);
            finalJobGap = Math.min(BASE_JOB_GAP + spacePerJob, MAX_JOB_GAP);
            
            console.log('Distributing remaining', remainingSpace.toFixed(0), 'px to gaps');
          }
        }
      } else {
        console.log('✅ Content fits well - minor adjustments only');
      }

      // Apply font scale using CSS font-size (not transform - cleaner rendering)
      const baseFontPt = 9;
      const newFontPt = baseFontPt * fontScale;
      element.style.fontSize = `${newFontPt}pt`;
      
      // Apply spacing
      element.style.setProperty('--section-gap', `${finalSectionGap}px`);
      element.style.setProperty('--job-gap', `${finalJobGap}px`);
      element.style.setProperty('--bullet-gap', `${finalBulletGap}px`);

      console.log('Final font size:', newFontPt.toFixed(2), 'pt');
      console.log('Final gaps - Section:', finalSectionGap.toFixed(1), 'Job:', finalJobGap.toFixed(1));
      console.log('=================================');

      // Second pass: verify and fine-tune
      requestAnimationFrame(() => {
        const finalHeight = measureContentHeight(element) - PADDING_TOP - PADDING_BOTTOM;
        const finalGap = USABLE_HEIGHT - finalHeight;
        
        console.log('Verification - Final gap:', finalGap.toFixed(0), 'px');
        
        // If still too much gap, increase font slightly more
        if (finalGap > 30 && fontScale < MAX_FONT_SCALE) {
          const adjustment = Math.min(1 + (finalGap / USABLE_HEIGHT), MAX_FONT_SCALE / fontScale);
          const adjustedFontPt = newFontPt * adjustment;
          element.style.fontSize = `${Math.min(adjustedFontPt, baseFontPt * MAX_FONT_SCALE)}pt`;
          console.log('Fine-tuned font to:', adjustedFontPt.toFixed(2), 'pt');
        }
      });
    });
  }, [measureContentHeight]);

  // Apply dynamic spacing whenever resume changes
  useEffect(() => {
    const timer = setTimeout(calculateAndApplySpacing, 100);
    return () => clearTimeout(timer);
  }, [resume, calculateAndApplySpacing]);

  const updateResume = (updates: Partial<ParsedResume>) => {
    const updated = { ...resume, ...updates };
    setResume(updated);
    onResumeChange(updated);
  };

  const updateContact = (field: keyof typeof resume.contact, value: string) => {
    updateResume({ contact: { ...resume.contact, [field]: value } });
  };

  const updateExperience = (index: number, updates: Partial<typeof resume.experience[0]>) => {
    const updated = [...resume.experience];
    updated[index] = { ...updated[index], ...updates };
    updateResume({ experience: updated });
  };

  const updateStartup = (index: number, updates: Partial<typeof resume.startups[0]>) => {
    const updated = [...resume.startups];
    updated[index] = { ...updated[index], ...updates };
    updateResume({ startups: updated });
  };

  const updateSkill = (index: number, updates: Partial<typeof resume.skills[0]>) => {
    const updated = [...resume.skills];
    updated[index] = { ...updated[index], ...updates };
    updateResume({ skills: updated });
  };

  const updateEducation = (index: number, updates: Partial<typeof resume.education[0]>) => {
    const updated = [...resume.education];
    updated[index] = { ...updated[index], ...updates };
    updateResume({ education: updated });
  };

  return (
    <div id="resume-preview" className="resume-preview" ref={resumeRef}>
      <div className="resume-content" ref={contentRef}>
        {/* Header - Center Aligned - CONSTANT DATA */}
        <header className="resume-header">
          <h1 className="resume-name">
            {CONSTANT_CONTACT.name}
          </h1>
          
          {/* Contact Line - Center Aligned with bullet separators */}
          <div className="contact-line">
            <span className="contact-separator">•</span>
            <a href={CONSTANT_CONTACT.linkedinUrl} target="_blank" rel="noopener noreferrer" className="contact-link">
              <span className="contact-item">
                <span>{CONSTANT_CONTACT.linkedin}</span>
              </span>
            </a>
            <span className="contact-separator">•</span>
            <a href={CONSTANT_CONTACT.portfolioUrl} target="_blank" rel="noopener noreferrer" className="contact-link">
              <span className="contact-item">
                <span>{CONSTANT_CONTACT.portfolio}</span>
              </span>
            </a>
            <span className="contact-separator">•</span>
            <span className="contact-item">
              <span>{CONSTANT_CONTACT.email}</span>
            </span>
            <span className="contact-separator">•</span>
            <span className="contact-item">
              <span>{CONSTANT_CONTACT.phone}</span>
            </span>
          </div>
        </header>

        {/* Experience */}
        {resume.experience.length > 0 && (
          <section className="resume-section">
            <h2 className="section-title">EXPERIENCE</h2>
            {resume.experience.map((job, index) => (
              <div key={index} className="job-entry">
                <div className="job-header">
                  <div className="job-title-line">
                    <span className="job-title">
                      <EditableText
                        value={job.title}
                        onChange={(val) => updateExperience(index, { title: val })}
                      />
                    </span>
                    {job.company && (
                      <>
                        <span className="separator"> | </span>
                        <span className="job-company">
                          <EditableText
                            value={job.company}
                            onChange={(val) => updateExperience(index, { company: val })}
                          />
                        </span>
                      </>
                    )}
                    {job.location && (
                      <>
                        <span className="separator"> | </span>
                        <span className="job-location">
                          <EditableText
                            value={job.location}
                            onChange={(val) => updateExperience(index, { location: val })}
                          />
                        </span>
                      </>
                    )}
                  </div>
                  {job.dateRange && (
                    <span className="job-date">
                      <EditableText
                        value={job.dateRange}
                        onChange={(val) => updateExperience(index, { dateRange: val })}
                      />
                    </span>
                  )}
                </div>
                {job.bullets.length > 0 && (
                  <EditableBulletList
                    bullets={job.bullets}
                    onChange={(bullets) => updateExperience(index, { bullets })}
                  />
                )}
              </div>
            ))}
          </section>
        )}

        {/* University Startups */}
        {resume.startups.length > 0 && (
          <section className="resume-section">
            <h2 className="section-title">UNIVERSITY STARTUPS</h2>
            <div className="startups-list">
              {resume.startups.map((startup, index) => (
                <div key={index} className="startup-entry">
                  <span className="startup-role">
                    <EditableText
                      value={startup.role}
                      onChange={(val) => updateStartup(index, { role: val })}
                    />
                  </span>
                  {startup.description && (
                    <>
                      <span className="separator"> - </span>
                      <span className="startup-desc">
                        <EditableText
                          value={startup.description}
                          onChange={(val) => updateStartup(index, { description: val })}
                          applyBoldMetrics={true}
                        />
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Skills */}
        {resume.skills.length > 0 && (
          <section className="resume-section">
            <h2 className="section-title">SKILLS & COMPETENCIES</h2>
            <div className="skills-list">
              {resume.skills.map((category, index) => (
                <div key={index} className="skill-line">
                  <span className="skill-label">
                    <EditableText
                      value={category.label}
                      onChange={(val) => updateSkill(index, { label: val })}
                    />
                  </span>
                  <span className="separator">: </span>
                  <span className="skill-content">
                    <EditableText
                      value={category.skills}
                      onChange={(val) => updateSkill(index, { skills: val })}
                    />
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Education - Always constant */}
        <section className="resume-section">
          <h2 className="section-title">EDUCATION</h2>
          <div className="education-entry">
            {/* Row 1: University Name, Location | Date */}
            <div className="education-header">
              <span className="education-school">
                {CONSTANT_EDUCATION.school}, {CONSTANT_EDUCATION.location}
              </span>
              <span className="education-date">
                {CONSTANT_EDUCATION.dateRange}
              </span>
            </div>
            
            {/* Row 2: Degree | CGPA (same line, left/right aligned) */}
            <div className="education-degree-row">
              <span className="education-degree">
                {CONSTANT_EDUCATION.degree}
              </span>
              <span className="education-gpa">
                CGPA: {CONSTANT_EDUCATION.gpa}
              </span>
            </div>
            
            {/* Row 3: Selected Coursework */}
            <div className="education-detail">
              Selected Coursework: {CONSTANT_EDUCATION.coursework}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
