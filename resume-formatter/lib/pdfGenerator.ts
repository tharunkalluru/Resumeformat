import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

/**
 * Generates an ATS-friendly PDF with both visual quality and parseable text.
 * 
 * Approach:
 * 1. Render the resume as an image for visual fidelity
 * 2. Add an invisible text layer for ATS parsing
 * 3. Add clickable hyperlinks
 */
export async function generatePDF(elementId: string = 'resume-preview', filename: string = 'resume.pdf'): Promise<void> {
  const resumeElement = document.getElementById(elementId);
  if (!resumeElement) {
    throw new Error('Resume preview element not found');
  }

  // Get the computed styles from the preview
  const computedStyle = window.getComputedStyle(resumeElement);
  const sectionGap = computedStyle.getPropertyValue('--section-gap').trim() || '8px';
  const jobGap = computedStyle.getPropertyValue('--job-gap').trim() || '6px';
  const bulletGap = computedStyle.getPropertyValue('--bullet-gap').trim() || '1px';

  console.log('[PDF] Generating ATS-friendly PDF...');

  // Clone the element for image rendering
  const clone = resumeElement.cloneNode(true) as HTMLElement;
  clone.id = 'resume-clone-for-pdf';
  
  // Remove contenteditable attributes
  clone.querySelectorAll('[contenteditable]').forEach(el => {
    el.removeAttribute('contenteditable');
    el.classList.remove('editable-field');
  });

  // Position off-screen for rendering
  clone.style.cssText = `
    position: absolute;
    left: -9999px;
    top: 0;
    width: 816px;
    height: 1056px;
    max-height: 1056px;
    overflow: hidden;
    padding: 36.5px 52.8px;
    margin: 0;
    background-color: #ffffff;
    color: #000000;
    font-family: Calibri, 'Segoe UI', Arial, sans-serif;
    font-size: 9pt;
    line-height: 1.45;
    box-sizing: border-box;
    transform: none;
  `;

  // Apply inline styles (same as before for visual consistency)
  applyInlineStyles(clone, sectionGap, jobGap, bulletGap);

  document.body.appendChild(clone);
  await new Promise(resolve => setTimeout(resolve, 50));

  try {
    // Generate canvas for the visual layer
    const canvas = await html2canvas(clone, {
      scale: 3,
      useCORS: true,
      logging: false,
      width: 816,
      height: 1056,
      backgroundColor: '#ffffff',
    });

    // Create PDF
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'pt', // Use points for text positioning
      format: 'letter',
      compress: true,
    });

    // Page dimensions in points (1 inch = 72 points)
    const PAGE_WIDTH_PT = 8.5 * 72; // 612pt
    const PAGE_HEIGHT_PT = 11 * 72; // 792pt
    const MARGIN_LEFT = 0.55 * 72; // ~40pt
    const MARGIN_TOP = 0.38 * 72; // ~27pt

    // Add the image layer
    const imgData = canvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, 0, PAGE_WIDTH_PT, PAGE_HEIGHT_PT, undefined, 'FAST');

    // ========== ADD INVISIBLE TEXT LAYER FOR ATS ==========
    // Add white text at actual positions (invisible on white bg, but parseable by ATS)
    addTextLayerWithPositions(pdf, resumeElement, PAGE_WIDTH_PT, PAGE_HEIGHT_PT);

    // ========== ADD CLICKABLE HYPERLINKS ==========
    const linkedinLink = resumeElement.querySelector('a[href*="linkedin"]') as HTMLAnchorElement;
    const portfolioLink = resumeElement.querySelector('a[href*="tharunkalluru.com"]') as HTMLAnchorElement;
    
    if (linkedinLink) {
      addLinkAnnotation(pdf, linkedinLink, resumeElement, PAGE_WIDTH_PT, PAGE_HEIGHT_PT);
    }
    
    if (portfolioLink) {
      addLinkAnnotation(pdf, portfolioLink, resumeElement, PAGE_WIDTH_PT, PAGE_HEIGHT_PT);
    }

    // Save the PDF
    pdf.save(filename);
    console.log('[PDF] Generated ATS-friendly PDF with text layer!');
    
  } finally {
    document.body.removeChild(clone);
  }
}

/**
 * Add text layer with actual positions (invisible but parseable)
 * This ensures ALL text is captured for ATS parsing
 */
function addTextLayerWithPositions(pdf: jsPDF, element: HTMLElement, pageWidth: number, pageHeight: number) {
  const resumeRect = element.getBoundingClientRect();
  
  // Scale factors (element is 816x1056 px, page is 612x792 pt)
  const scaleX = pageWidth / 816;
  const scaleY = pageHeight / 1056;
  
  // Set invisible text properties - white text on white background
  pdf.setTextColor(255, 255, 255);
  
  // Helper to add text at element's position
  const addTextAtElement = (el: Element | null, fontSize: number = 9, fontStyle: string = 'normal') => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const text = el.textContent?.trim() || '';
    if (!text) return;
    
    const x = (rect.left - resumeRect.left) * scaleX;
    const y = (rect.top - resumeRect.top) * scaleY + fontSize;
    
    pdf.setFontSize(fontSize);
    pdf.setFont('helvetica', fontStyle);
    
    const maxWidth = Math.max((rect.width * scaleX), 100) || (pageWidth - x - 40);
    const lines = pdf.splitTextToSize(text, maxWidth);
    pdf.text(lines, x, y);
  };
  
  // Helper to add raw text at specific position
  const addTextAtPosition = (text: string, x: number, y: number, fontSize: number = 9, fontStyle: string = 'normal') => {
    if (!text.trim()) return;
    pdf.setFontSize(fontSize);
    pdf.setFont('helvetica', fontStyle);
    pdf.text(text, x, y);
  };
  
  // ========== 1. NAME ==========
  addTextAtElement(element.querySelector('.resume-name'), 20, 'bold');
  
  // ========== 2. CONTACT INFORMATION ==========
  // Get all contact items and extract their text (excluding icons)
  const contactLine = element.querySelector('.contact-line');
  if (contactLine) {
    const contactRect = contactLine.getBoundingClientRect();
    const contactY = (contactRect.top - resumeRect.top) * scaleY + 9;
    
    // Build full contact string for ATS
    const contactTexts: string[] = [];
    
    // LinkedIn
    const linkedinText = element.querySelector('.contact-link[href*="linkedin"] .contact-item span:not(.contact-icon)');
    if (linkedinText) contactTexts.push('LinkedIn: ' + (linkedinText.textContent?.trim() || ''));
    
    // Portfolio
    const portfolioText = element.querySelector('.contact-link[href*="tharunkalluru"] .contact-item span:not(.contact-icon)');
    if (portfolioText) contactTexts.push('Portfolio: ' + (portfolioText.textContent?.trim() || ''));
    
    // Email - direct contact-item (not in a link)
    element.querySelectorAll('.contact-item').forEach(item => {
      const icon = item.querySelector('.contact-icon');
      const textSpan = item.querySelector('span:not(.contact-icon)');
      if (icon && textSpan) {
        const iconText = icon.textContent?.trim() || '';
        const value = textSpan.textContent?.trim() || '';
        
        if (iconText === '@' && value.includes('@')) {
          contactTexts.push('Email: ' + value);
        } else if (iconText === '✆' || item.classList.contains('contact-item-phone')) {
          contactTexts.push('Phone: ' + value);
        }
      }
    });
    
    // Add contact info as a single line for better ATS parsing
    const fullContact = contactTexts.join(' | ');
    if (fullContact) {
      addTextAtPosition(fullContact, (contactRect.left - resumeRect.left) * scaleX, contactY, 9);
    }
  }
  
  // ========== 3. ALL SECTIONS ==========
  element.querySelectorAll('.resume-section').forEach(section => {
    // Section title
    addTextAtElement(section.querySelector('.section-title'), 10, 'bold');
    
    // ===== JOB ENTRIES =====
    section.querySelectorAll('.job-entry').forEach(job => {
      // Job header line (Title | Company | Location)
      const jobTitleLine = job.querySelector('.job-title-line');
      if (jobTitleLine) {
        const titleEl = jobTitleLine.querySelector('.job-title');
        const companyEl = jobTitleLine.querySelector('.job-company');
        const locationEl = jobTitleLine.querySelector('.job-location');
        
        const parts = [
          titleEl?.textContent?.trim(),
          companyEl?.textContent?.trim(),
          locationEl?.textContent?.trim()
        ].filter(Boolean);
        
        const jobHeaderText = parts.join(' | ');
        const rect = jobTitleLine.getBoundingClientRect();
        const x = (rect.left - resumeRect.left) * scaleX;
        const y = (rect.top - resumeRect.top) * scaleY + 9.5;
        addTextAtPosition(jobHeaderText, x, y, 9.5, 'bold');
      }
      
      // Job date
      addTextAtElement(job.querySelector('.job-date'), 9, 'italic');
      
      // Bullet points - add each one
      job.querySelectorAll('.resume-bullets li').forEach(bullet => {
        const bulletText = '• ' + (bullet.textContent?.trim() || '');
        const rect = bullet.getBoundingClientRect();
        const x = (rect.left - resumeRect.left) * scaleX;
        const y = (rect.top - resumeRect.top) * scaleY + 9;
        const maxWidth = (rect.width * scaleX) || (pageWidth - x - 20);
        
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'normal');
        const lines = pdf.splitTextToSize(bulletText, maxWidth);
        pdf.text(lines, x, y);
      });
    });
    
    // ===== SKILLS =====
    section.querySelectorAll('.skill-line').forEach(skill => {
      const label = skill.querySelector('.skill-label')?.textContent?.trim() || '';
      const content = skill.querySelector('.skill-content')?.textContent?.trim() || '';
      const skillText = label + ': ' + content;
      
      const rect = skill.getBoundingClientRect();
      const x = (rect.left - resumeRect.left) * scaleX;
      const y = (rect.top - resumeRect.top) * scaleY + 9;
      const maxWidth = (rect.width * scaleX) || (pageWidth - x - 20);
      
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      const lines = pdf.splitTextToSize(skillText, maxWidth);
      pdf.text(lines, x, y);
    });
    
    // ===== STARTUPS =====
    section.querySelectorAll('.startup-entry').forEach(startup => {
      const role = startup.querySelector('.startup-role')?.textContent?.trim() || '';
      const desc = startup.querySelector('.startup-desc')?.textContent?.trim() || '';
      const startupText = role + (desc ? ' - ' + desc : '');
      
      const rect = startup.getBoundingClientRect();
      const x = (rect.left - resumeRect.left) * scaleX;
      const y = (rect.top - resumeRect.top) * scaleY + 9;
      const maxWidth = (rect.width * scaleX) || (pageWidth - x - 20);
      
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      const lines = pdf.splitTextToSize(startupText, maxWidth);
      pdf.text(lines, x, y);
    });
    
    // ===== EDUCATION =====
    const eduEntry = section.querySelector('.education-entry');
    if (eduEntry) {
      // School and location
      addTextAtElement(section.querySelector('.education-school'), 9.5, 'bold');
      
      // Date
      addTextAtElement(section.querySelector('.education-date'), 9, 'italic');
      
      // Degree
      addTextAtElement(section.querySelector('.education-degree'), 9);
      
      // GPA
      addTextAtElement(section.querySelector('.education-gpa'), 9);
      
      // Coursework detail
      addTextAtElement(section.querySelector('.education-detail'), 9);
    }
  });
  
  // ========== 4. ADD FULL TEXT DUMP AT END (BACKUP FOR ATS) ==========
  // Some ATS systems work better with a consolidated text block
  // Add all resume text as a tiny invisible block at the very bottom
  const allText = extractAllText(element);
  if (allText) {
    pdf.setFontSize(0.5); // Extremely small
    pdf.setFont('helvetica', 'normal');
    const lines = pdf.splitTextToSize(allText, pageWidth - 40);
    // Position at very bottom, virtually invisible
    pdf.text(lines, 20, pageHeight - 5);
  }
}

/**
 * Extract all text content from resume for ATS backup
 */
function extractAllText(element: HTMLElement): string {
  const parts: string[] = [];
  
  // Name
  const name = element.querySelector('.resume-name')?.textContent?.trim();
  if (name) parts.push(name);
  
  // Contact
  const email = element.querySelector('.icon-email')?.parentElement?.querySelector('span:not(.contact-icon)')?.textContent?.trim();
  const phone = element.querySelector('.icon-phone')?.parentElement?.querySelector('span:not(.contact-icon)')?.textContent?.trim();
  const linkedin = element.querySelector('.icon-linkedin')?.parentElement?.querySelector('span:not(.contact-icon)')?.textContent?.trim();
  const portfolio = element.querySelector('.icon-web')?.parentElement?.querySelector('span:not(.contact-icon)')?.textContent?.trim();
  
  if (email) parts.push('Email: ' + email);
  if (phone) parts.push('Phone: ' + phone);
  if (linkedin) parts.push('LinkedIn: ' + linkedin);
  if (portfolio) parts.push('Portfolio: ' + portfolio);
  
  // Sections
  element.querySelectorAll('.resume-section').forEach(section => {
    const title = section.querySelector('.section-title')?.textContent?.trim();
    if (title) parts.push('\n' + title);
    
    // Jobs
    section.querySelectorAll('.job-entry').forEach(job => {
      const titleLine = job.querySelector('.job-title-line')?.textContent?.trim();
      const date = job.querySelector('.job-date')?.textContent?.trim();
      if (titleLine) parts.push(titleLine + (date ? ' ' + date : ''));
      
      job.querySelectorAll('.resume-bullets li').forEach(bullet => {
        parts.push('• ' + (bullet.textContent?.trim() || ''));
      });
    });
    
    // Skills
    section.querySelectorAll('.skill-line').forEach(skill => {
      parts.push(skill.textContent?.trim() || '');
    });
    
    // Startups
    section.querySelectorAll('.startup-entry').forEach(startup => {
      parts.push(startup.textContent?.trim() || '');
    });
    
    // Education
    const school = section.querySelector('.education-school')?.textContent?.trim();
    const eduDate = section.querySelector('.education-date')?.textContent?.trim();
    const degree = section.querySelector('.education-degree')?.textContent?.trim();
    const gpa = section.querySelector('.education-gpa')?.textContent?.trim();
    const coursework = section.querySelector('.education-detail')?.textContent?.trim();
    
    if (school) parts.push(school + (eduDate ? ' ' + eduDate : ''));
    if (degree) parts.push(degree + (gpa ? ' ' + gpa : ''));
    if (coursework) parts.push(coursework);
  });
  
  return parts.filter(p => p).join(' ');
}

/**
 * Add clickable link annotation to PDF
 */
function addLinkAnnotation(pdf: jsPDF, linkEl: HTMLAnchorElement, resumeEl: HTMLElement, pageWidth: number, pageHeight: number) {
  const rect = linkEl.getBoundingClientRect();
  const resumeRect = resumeEl.getBoundingClientRect();
  
  const scaleX = pageWidth / 816;
  const scaleY = pageHeight / 1056;
  
  const x = (rect.left - resumeRect.left) * scaleX;
  const y = (rect.top - resumeRect.top) * scaleY;
  const width = rect.width * scaleX;
  const height = rect.height * scaleY;
  
  pdf.link(x, y, width, height, { url: linkEl.href });
  console.log('[PDF] Added link:', linkEl.href);
}

/**
 * Apply inline styles to clone for consistent rendering
 */
function applyInlineStyles(clone: HTMLElement, sectionGap: string, jobGap: string, bulletGap: string) {
  // HEADER
  const header = clone.querySelector('.resume-header') as HTMLElement;
  if (header) {
    header.style.cssText = `text-align: center; margin: 0 0 10px 0; padding: 0;`;
  }

  // NAME
  const name = clone.querySelector('.resume-name') as HTMLElement;
  if (name) {
    name.style.cssText = `font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 20pt; font-weight: bold; color: #000000; margin: 0 0 6px 0; padding: 0; display: block; text-align: center;`;
  }

  // CONTACT LINE
  const contactLine = clone.querySelector('.contact-line') as HTMLElement;
  if (contactLine) {
    contactLine.style.cssText = `display: flex; flex-wrap: wrap; justify-content: center; align-items: baseline; gap: 12px; font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 9pt; color: #333333; margin: 0; padding: 0;`;
  }

  // CONTACT LINKS
  clone.querySelectorAll('.contact-link').forEach((link: Element) => {
    (link as HTMLElement).style.cssText = `color: inherit; text-decoration: none;`;
  });

  // CONTACT ITEMS
  clone.querySelectorAll('.contact-item').forEach((item: Element) => {
    const isPhoneItem = item.classList.contains('contact-item-phone');
    (item as HTMLElement).style.cssText = `display: inline-flex; align-items: ${isPhoneItem ? 'center' : 'baseline'}; gap: 3px;`;
  });

  // CONTACT ICONS
  clone.querySelectorAll('.contact-icon').forEach((icon: Element) => {
    const el = icon as HTMLElement;
    const baseStyle = `font-family: Arial, Helvetica, sans-serif; font-weight: bold; color: #000000; display: inline-block; width: 14px; height: 14px; line-height: 14px; text-align: center; vertical-align: baseline; flex-shrink: 0;`;
    
    if (icon.classList.contains('icon-linkedin')) {
      el.style.cssText = baseStyle + 'font-size: 9pt;';
    } else if (icon.classList.contains('icon-web')) {
      el.style.cssText = baseStyle + 'font-size: 8pt; color: #000000;';
    } else if (icon.classList.contains('icon-email')) {
      el.style.cssText = baseStyle + 'font-size: 7pt;';
    } else if (icon.classList.contains('icon-phone')) {
      el.style.cssText = baseStyle + 'font-size: 8.3pt; vertical-align: middle;';
    } else {
      el.style.cssText = baseStyle + 'font-size: 9pt;';
    }
  });

  // SECTIONS
  clone.querySelectorAll('.resume-section').forEach((section: Element) => {
    (section as HTMLElement).style.cssText = `margin-top: ${sectionGap}; padding: 0;`;
  });

  // SECTION TITLES
  clone.querySelectorAll('.section-title').forEach((title: Element) => {
    (title as HTMLElement).style.cssText = `font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 10pt; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #000000; padding: 0 0 8px 0; border-bottom: 1.5px solid #000000; margin: 0 0 8px 0; display: block; text-align: left;`;
  });

  // JOB ENTRIES
  const jobEntries = clone.querySelectorAll('.job-entry');
  jobEntries.forEach((entry: Element, index: number) => {
    const isLast = index === jobEntries.length - 1;
    (entry as HTMLElement).style.cssText = `margin: 0 0 ${isLast ? '0' : jobGap} 0; padding: 0;`;
  });

  // JOB HEADERS
  clone.querySelectorAll('.job-header').forEach((header: Element) => {
    (header as HTMLElement).style.cssText = `display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin: 0 0 3px 0; padding: 0;`;
  });

  // JOB TITLE LINES
  clone.querySelectorAll('.job-title-line').forEach((line: Element) => {
    (line as HTMLElement).style.cssText = `font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 9.5pt; color: #000000; text-align: left;`;
  });

  // JOB TITLES
  clone.querySelectorAll('.job-title').forEach((title: Element) => {
    (title as HTMLElement).style.fontWeight = 'bold';
  });

  // JOB DATES
  clone.querySelectorAll('.job-date').forEach((date: Element) => {
    (date as HTMLElement).style.cssText = `font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 9pt; color: #333333; font-style: italic; white-space: nowrap; flex-shrink: 0; text-align: right;`;
  });

  // BULLET LISTS
  clone.querySelectorAll('.resume-bullets').forEach((list: Element) => {
    (list as HTMLElement).style.cssText = `margin: 3px 0 0 0; padding: 0 0 0 12px; list-style: none;`;
  });

  // BULLET ITEMS
  clone.querySelectorAll('.resume-bullets li').forEach((bullet: Element) => {
    const parent = bullet.parentElement;
    const isLast = parent ? bullet === parent.lastElementChild : false;
    (bullet as HTMLElement).style.cssText = `font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 9pt; line-height: 1.45; margin: 0 0 ${isLast ? '0' : bulletGap} 0; padding: 0; position: relative; color: #000000;`;
  });

  // EDUCATION HEADERS
  clone.querySelectorAll('.education-header').forEach((header: Element) => {
    (header as HTMLElement).style.cssText = `display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin: 0; padding: 0;`;
  });

  // EDUCATION SCHOOLS
  clone.querySelectorAll('.education-school').forEach((school: Element) => {
    (school as HTMLElement).style.cssText = `font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 9.5pt; font-weight: bold; color: #000000; text-align: left;`;
  });

  // EDUCATION DATES
  clone.querySelectorAll('.education-date').forEach((date: Element) => {
    (date as HTMLElement).style.cssText = `font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 9pt; color: #333333; font-style: italic; white-space: nowrap; flex-shrink: 0; text-align: right;`;
  });

  // EDUCATION DEGREE ROWS
  clone.querySelectorAll('.education-degree-row').forEach((row: Element) => {
    (row as HTMLElement).style.cssText = `display: flex; justify-content: space-between; align-items: center; gap: 10px; margin: 4px 0 0 0; padding: 0;`;
  });

  // EDUCATION DEGREES
  clone.querySelectorAll('.education-degree').forEach((degree: Element) => {
    (degree as HTMLElement).style.cssText = `font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 9pt; line-height: 1.45; color: #000000; text-align: left; flex: 1;`;
  });

  // EDUCATION GPAs
  clone.querySelectorAll('.education-gpa').forEach((gpa: Element) => {
    (gpa as HTMLElement).style.cssText = `font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 9pt; line-height: 1.45; color: #000000; text-align: right; white-space: nowrap; flex-shrink: 0;`;
  });

  // EDUCATION DETAILS
  clone.querySelectorAll('.education-detail').forEach((detail: Element) => {
    (detail as HTMLElement).style.cssText = `font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 9pt; margin: 3px 0 0 0; padding: 0; line-height: 1.45; color: #000000;`;
  });

  // STARTUP ENTRIES
  const startupEntries = clone.querySelectorAll('.startup-entry');
  startupEntries.forEach((entry: Element, index: number) => {
    const isLast = index === startupEntries.length - 1;
    (entry as HTMLElement).style.cssText = `font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 9pt; margin: 0 0 ${isLast ? '0' : '5px'} 0; padding: 0; line-height: 1.45; color: #000000;`;
  });

  // STARTUP ROLES
  clone.querySelectorAll('.startup-role').forEach((role: Element) => {
    (role as HTMLElement).style.fontWeight = 'bold';
  });

  // SKILL LINES
  const skillLines = clone.querySelectorAll('.skill-line');
  skillLines.forEach((line: Element, index: number) => {
    const isLast = index === skillLines.length - 1;
    (line as HTMLElement).style.cssText = `font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 9pt; margin: 0 0 ${isLast ? '0' : '5px'} 0; padding: 0; line-height: 1.45; color: #000000;`;
  });

  // SKILL LABELS
  clone.querySelectorAll('.skill-label').forEach((label: Element) => {
    (label as HTMLElement).style.fontWeight = 'bold';
  });

  // BOLD METRICS
  clone.querySelectorAll('strong').forEach((el: Element) => {
    (el as HTMLElement).style.fontWeight = 'bold';
    (el as HTMLElement).style.color = '#000000';
  });
}
