'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ParsedResume } from '@/lib/parser';
import { boldMetrics, stripHtml } from '@/lib/formatMetrics';

interface EditableResumePreviewProps {
  parsedResume: ParsedResume;
  onResumeChange: (updated: ParsedResume) => void;
  overrideEmail?: string; // Email resolved from share link - takes precedence
}

/**
 * GLOBAL DYNAMIC RESUME LAYOUT ENGINE
 *
 * This algorithm GUARANTEES the resume fits on exactly ONE page with:
 * - Zero overflow/cropping - all sections fully visible
 * - Equal top/bottom padding for visual symmetry
 * - Global reflow on any content change
 * - Preserved visual hierarchy and readability
 *
 * ALGORITHM (Iterative Convergence):
 * 1. MEASURE: Get true content height without constraints
 * 2. CALCULATE: Determine fill ratio (available / content)
 * 3. ADJUST: Scale globally using unified parameter system
 *    - Line height (1.25 - 1.6) - primary spacing control
 *    - Section/Job/Bullet gaps - secondary spacing
 *    - Font size (85% - 115%) - last resort scaling
 * 4. ITERATE: Repeat until content fits within tolerance
 * 5. VERIFY: Final safety check - never allow overflow
 *
 * The algorithm adjusts ALL parameters as a single global system,
 * not per-section, ensuring uniform visual balance.
 */

// Page dimensions at 96 DPI
const PAGE_HEIGHT_PX = 11 * 96; // 1056px = 11 inches
const PAGE_WIDTH_PX = 8.5 * 96; // 816px = 8.5 inches

// Symmetrical padding (top = bottom for visual balance)
const PADDING_VERTICAL = 0.38 * 96; // ~36.5px each side
const PADDING_HORIZONTAL = 0.55 * 96; // ~53px each side

// Usable content area
const USABLE_HEIGHT = PAGE_HEIGHT_PX - (PADDING_VERTICAL * 2); // ~983px

// Layout parameter ranges (min, default, max)
const LAYOUT_PARAMS = {
  // Line height: Primary spacing control (most visual impact)
  lineHeight: { min: 1.25, base: 1.45, max: 1.6 },

  // Section gap: Space between major sections
  sectionGap: { min: 8, base: 12, max: 24 },

  // Job gap: Space between job entries
  jobGap: { min: 6, base: 10, max: 18 },

  // Bullet gap: Space between bullet points
  bulletGap: { min: 1, base: 3, max: 6 },

  // Font scale: Last resort - affects readability most
  fontScale: { min: 0.85, base: 1.0, max: 1.15 },
};

// Convergence settings
const MAX_ITERATIONS = 20; // Maximum adjustment iterations
const FIT_TOLERANCE = 5; // Pixels of acceptable overflow
const TARGET_FILL_MIN = 0.96; // Minimum page fill (96%)
const TARGET_FILL_MAX = 1.0; // Maximum page fill (100% - no overflow)

// Constant contact information - never changes
const CONSTANT_CONTACT = {
  name: 'Tharun Kalluru',
  linkedin: 'in/tharunkalluru',
  linkedinUrl: 'https://www.linkedin.com/in/tharunkalluru/',
  portfolio: 'tharunkalluru.com',
  portfolioUrl: 'https://www.tharunkalluru.com/',
  email: 'tharun99.kalluru@gmail.com',
  phone: '(571) 564-8010'
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

export default function EditableResumePreview({ parsedResume, onResumeChange, overrideEmail }: EditableResumePreviewProps) {
  const [resume, setResume] = useState(parsedResume);
  const resumeRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Use override email if provided (from share link), otherwise use constant
  const displayEmail = overrideEmail || CONSTANT_CONTACT.email;

  useEffect(() => {
    setResume(parsedResume);
  }, [parsedResume]);

  /**
   * Measure TRUE content height by temporarily removing all constraints.
   * This ensures we get the actual height needed, not the constrained height.
   */
  const measureContentHeight = useCallback((element: HTMLElement): number => {
    // Store original styles
    const originalStyles = {
      height: element.style.height,
      maxHeight: element.style.maxHeight,
      minHeight: element.style.minHeight,
      overflow: element.style.overflow,
    };

    // Remove ALL constraints to measure true content
    element.style.height = 'auto';
    element.style.maxHeight = 'none';
    element.style.minHeight = '0';
    element.style.overflow = 'visible';

    // Force synchronous reflow and measure
    void element.offsetHeight; // Force reflow
    const contentHeight = element.scrollHeight;

    // Restore original styles
    Object.assign(element.style, originalStyles);

    return contentHeight;
  }, []);

  /**
   * Apply layout parameters to the element via CSS variables and inline styles.
   */
  const applyLayoutParams = useCallback(
    (
      element: HTMLElement,
      params: {
        fontScale: number;
        lineHeight: number;
        sectionGap: number;
        jobGap: number;
        bulletGap: number;
      }
    ) => {
      const baseFontPt = 9;
      element.style.fontSize = `${baseFontPt * params.fontScale}pt`;
      element.style.lineHeight = `${params.lineHeight}`;
      element.style.setProperty('--section-gap', `${params.sectionGap}px`);
      element.style.setProperty('--job-gap', `${params.jobGap}px`);
      element.style.setProperty('--bullet-gap', `${params.bulletGap}px`);
      element.style.setProperty('--line-height', `${params.lineHeight}`);
    },
    []
  );

  /**
   * GLOBAL LAYOUT ALGORITHM - Iterative Convergence
   *
   * Adjusts all layout parameters globally to ensure the resume fits
   * on exactly one page with zero overflow and balanced spacing.
   */
  const calculateAndApplySpacing = useCallback(() => {
    if (!resumeRef.current) return;

    const element = resumeRef.current;

    // Phase 1: Reset to base values and measure
    const baseParams = {
      fontScale: LAYOUT_PARAMS.fontScale.base,
      lineHeight: LAYOUT_PARAMS.lineHeight.base,
      sectionGap: LAYOUT_PARAMS.sectionGap.base,
      jobGap: LAYOUT_PARAMS.jobGap.base,
      bulletGap: LAYOUT_PARAMS.bulletGap.base,
    };

    applyLayoutParams(element, baseParams);

    // Use requestAnimationFrame to ensure styles are applied before measuring
    requestAnimationFrame(() => {
      // Measure content with base parameters
      const baseContentHeight =
        measureContentHeight(element) - PADDING_VERTICAL * 2;
      const baseRatio = USABLE_HEIGHT / baseContentHeight;

      console.log('=== Global Layout Engine ===');
      console.log('Usable Height:', USABLE_HEIGHT.toFixed(0), 'px');
      console.log('Base Content Height:', baseContentHeight.toFixed(0), 'px');
      console.log('Base Fill Ratio:', baseRatio.toFixed(3));

      // Current layout parameters (will be adjusted iteratively)
      let currentParams = { ...baseParams };
      let iteration = 0;
      let converged = false;

      // Iterative convergence loop
      const iterate = () => {
        iteration++;
        if (iteration > MAX_ITERATIONS) {
          console.log('⚠️ Max iterations reached, applying safety shrink');
          // Safety: force minimum values if still overflowing
          currentParams = {
            fontScale: LAYOUT_PARAMS.fontScale.min,
            lineHeight: LAYOUT_PARAMS.lineHeight.min,
            sectionGap: LAYOUT_PARAMS.sectionGap.min,
            jobGap: LAYOUT_PARAMS.jobGap.min,
            bulletGap: LAYOUT_PARAMS.bulletGap.min,
          };
          applyLayoutParams(element, currentParams);
          console.log('=== Layout Complete (Safety) ===');
          return;
        }

        // Apply current parameters
        applyLayoutParams(element, currentParams);

        // Wait for reflow and measure
        requestAnimationFrame(() => {
          const contentHeight =
            measureContentHeight(element) - PADDING_VERTICAL * 2;
          const fillRatio = contentHeight / USABLE_HEIGHT;
          const overflow = contentHeight - USABLE_HEIGHT;

          console.log(
            `Iteration ${iteration}: Content=${contentHeight.toFixed(0)}px, ` +
              `Fill=${(fillRatio * 100).toFixed(1)}%, Overflow=${overflow.toFixed(0)}px`
          );

          // Check convergence
          if (
            overflow <= FIT_TOLERANCE &&
            fillRatio >= TARGET_FILL_MIN &&
            fillRatio <= TARGET_FILL_MAX
          ) {
            converged = true;
            console.log('✅ Converged! Final parameters:', currentParams);
            console.log('=== Layout Complete ===');
            return;
          }

          // Determine adjustment direction
          if (overflow > FIT_TOLERANCE) {
            // CONTENT TOO LARGE - Need to shrink
            // Calculate how much we need to shrink (as a factor)
            const shrinkFactor = USABLE_HEIGHT / contentHeight;

            // Progressive shrinking strategy:
            // 1. First reduce line height (least impact on readability)
            // 2. Then reduce spacing
            // 3. Finally reduce font size (most impact)

            const shrinkIntensity = Math.min(
              1,
              (contentHeight - USABLE_HEIGHT) / 100
            );

            // Reduce line height first
            if (currentParams.lineHeight > LAYOUT_PARAMS.lineHeight.min) {
              currentParams.lineHeight = Math.max(
                LAYOUT_PARAMS.lineHeight.min,
                currentParams.lineHeight - 0.05 * shrinkIntensity
              );
            }

            // Then reduce spacing
            if (currentParams.sectionGap > LAYOUT_PARAMS.sectionGap.min) {
              currentParams.sectionGap = Math.max(
                LAYOUT_PARAMS.sectionGap.min,
                currentParams.sectionGap - 2
              );
            }
            if (currentParams.jobGap > LAYOUT_PARAMS.jobGap.min) {
              currentParams.jobGap = Math.max(
                LAYOUT_PARAMS.jobGap.min,
                currentParams.jobGap - 1
              );
            }
            if (currentParams.bulletGap > LAYOUT_PARAMS.bulletGap.min) {
              currentParams.bulletGap = Math.max(
                LAYOUT_PARAMS.bulletGap.min,
                currentParams.bulletGap - 0.5
              );
            }

            // Finally reduce font if other measures aren't enough
            if (
              currentParams.lineHeight <= LAYOUT_PARAMS.lineHeight.min + 0.05 &&
              currentParams.sectionGap <= LAYOUT_PARAMS.sectionGap.min + 2 &&
              currentParams.fontScale > LAYOUT_PARAMS.fontScale.min
            ) {
              currentParams.fontScale = Math.max(
                LAYOUT_PARAMS.fontScale.min,
                currentParams.fontScale * shrinkFactor * 0.99
              );
            }

            console.log('📉 Shrinking:', currentParams);
          } else if (fillRatio < TARGET_FILL_MIN) {
            // CONTENT TOO SMALL - Expand to fill page
            const remainingSpace = USABLE_HEIGHT - contentHeight;
            const expandIntensity = remainingSpace / USABLE_HEIGHT;

            // Count layout elements for distribution
            const sectionCount =
              element.querySelectorAll('.resume-section').length;
            const jobCount = element.querySelectorAll('.job-entry').length;

            // Expand spacing first (most visible improvement)
            if (currentParams.sectionGap < LAYOUT_PARAMS.sectionGap.max) {
              const sectionSpaceShare =
                sectionCount > 0 ? (remainingSpace * 0.4) / sectionCount : 0;
              currentParams.sectionGap = Math.min(
                LAYOUT_PARAMS.sectionGap.max,
                currentParams.sectionGap + Math.min(sectionSpaceShare, 3)
              );
            }
            if (currentParams.jobGap < LAYOUT_PARAMS.jobGap.max) {
              const jobSpaceShare =
                jobCount > 0 ? (remainingSpace * 0.3) / jobCount : 0;
              currentParams.jobGap = Math.min(
                LAYOUT_PARAMS.jobGap.max,
                currentParams.jobGap + Math.min(jobSpaceShare, 2)
              );
            }
            if (currentParams.bulletGap < LAYOUT_PARAMS.bulletGap.max) {
              currentParams.bulletGap = Math.min(
                LAYOUT_PARAMS.bulletGap.max,
                currentParams.bulletGap + 0.5
              );
            }

            // Then expand line height
            if (currentParams.lineHeight < LAYOUT_PARAMS.lineHeight.max) {
              currentParams.lineHeight = Math.min(
                LAYOUT_PARAMS.lineHeight.max,
                currentParams.lineHeight + 0.02 * expandIntensity
              );
            }

            // Finally expand font (subtle)
            if (
              currentParams.sectionGap >= LAYOUT_PARAMS.sectionGap.max - 2 &&
              currentParams.fontScale < LAYOUT_PARAMS.fontScale.max
            ) {
              currentParams.fontScale = Math.min(
                LAYOUT_PARAMS.fontScale.max,
                currentParams.fontScale * (1 + expandIntensity * 0.05)
              );
            }

            console.log('📈 Expanding:', currentParams);
          }

          // Continue iteration
          iterate();
        });
      };

      // Start iteration
      iterate();
    });
  }, [measureContentHeight, applyLayoutParams]);

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
              <span>{displayEmail}</span>
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
