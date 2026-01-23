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
    // This text is positioned behind the image but is still parseable by ATS
    
    // Extract text content from the resume
    const textElements = extractTextElements(resumeElement);
    
    // Set text to be invisible (render mode 3 = invisible)
    // We'll use a workaround: very small transparent text at the end
    // OR position text exactly where it appears and use white color (invisible on white bg)
    
    // Actually, let's add the text with opacity 0 using a different approach:
    // Add text layer BEFORE the image, then the image goes on top
    // But jsPDF renders in order, so we need to use setGState for transparency
    
    // Alternative: Add text as white on white (invisible to eye, readable by ATS)
    // This is the most reliable method for ATS compatibility
    
    pdf.setTextColor(255, 255, 255); // White text (invisible on white background)
    pdf.setFontSize(1); // Tiny font
    
    // Add all extracted text at the bottom of the page (hidden but parseable)
    const fullText = textElements.join('\n');
    const lines = pdf.splitTextToSize(fullText, PAGE_WIDTH_PT - 100);
    
    // Position at bottom of page (will be "invisible")
    let yPosition = PAGE_HEIGHT_PT - 10;
    
    // Actually, better approach: overlay text at actual positions
    // Let's add text with transparency instead

    // Reset and use actual positioning with transparency
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
 * Extract all text content from resume elements
 */
function extractTextElements(element: HTMLElement): string[] {
  const texts: string[] = [];
  
  // Name
  const name = element.querySelector('.resume-name');
  if (name) texts.push(name.textContent || '');
  
  // Contact info
  const contactLine = element.querySelector('.contact-line');
  if (contactLine) texts.push(contactLine.textContent || '');
  
  // Sections
  element.querySelectorAll('.resume-section').forEach(section => {
    const title = section.querySelector('.section-title');
    if (title) texts.push(title.textContent || '');
    
    // Job entries
    section.querySelectorAll('.job-entry').forEach(job => {
      const jobTitle = job.querySelector('.job-title-line');
      const jobDate = job.querySelector('.job-date');
      if (jobTitle) texts.push(jobTitle.textContent || '');
      if (jobDate) texts.push(jobDate.textContent || '');
      
      job.querySelectorAll('.resume-bullets li').forEach(bullet => {
        texts.push('• ' + (bullet.textContent || ''));
      });
    });
    
    // Skills
    section.querySelectorAll('.skill-line').forEach(skill => {
      texts.push(skill.textContent || '');
    });
    
    // Startups
    section.querySelectorAll('.startup-entry').forEach(startup => {
      texts.push(startup.textContent || '');
    });
    
    // Education
    section.querySelectorAll('.education-entry').forEach(edu => {
      texts.push(edu.textContent || '');
    });
  });
  
  return texts.filter(t => t.trim());
}

/**
 * Add text layer with actual positions (invisible but parseable)
 */
function addTextLayerWithPositions(pdf: jsPDF, element: HTMLElement, pageWidth: number, pageHeight: number) {
  const resumeRect = element.getBoundingClientRect();
  
  // Scale factors (element is 816x1056 px, page is 612x792 pt)
  const scaleX = pageWidth / 816;
  const scaleY = pageHeight / 1056;
  
  // Set invisible text properties
  pdf.setTextColor(255, 255, 255); // White (invisible on white bg)
  
  // Helper to add text at position
  const addText = (el: Element | null, fontSize: number = 9, fontStyle: string = 'normal') => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const text = el.textContent?.trim() || '';
    if (!text) return;
    
    const x = (rect.left - resumeRect.left) * scaleX;
    const y = (rect.top - resumeRect.top) * scaleY + fontSize; // Add font size for baseline
    
    pdf.setFontSize(fontSize);
    pdf.setFont('helvetica', fontStyle);
    
    // Limit text width to prevent overflow
    const maxWidth = (rect.width * scaleX) || (pageWidth - x - 40);
    const lines = pdf.splitTextToSize(text, maxWidth);
    pdf.text(lines, x, y);
  };
  
  // Add name
  addText(element.querySelector('.resume-name'), 20, 'bold');
  
  // Add contact line text (plain text, not the icons)
  const contactItems = element.querySelectorAll('.contact-item');
  contactItems.forEach(item => {
    const textSpan = item.querySelector('span:not(.contact-icon)');
    if (textSpan) addText(textSpan, 9);
  });
  
  // Add section content
  element.querySelectorAll('.resume-section').forEach(section => {
    // Section title
    addText(section.querySelector('.section-title'), 10, 'bold');
    
    // Job entries
    section.querySelectorAll('.job-entry').forEach(job => {
      addText(job.querySelector('.job-title-line'), 9.5, 'bold');
      addText(job.querySelector('.job-date'), 9, 'italic');
      
      job.querySelectorAll('.resume-bullets li').forEach(bullet => {
        addText(bullet, 9);
      });
    });
    
    // Skills
    section.querySelectorAll('.skill-line').forEach(skill => {
      addText(skill, 9);
    });
    
    // Startups
    section.querySelectorAll('.startup-entry').forEach(startup => {
      addText(startup, 9);
    });
    
    // Education
    addText(section.querySelector('.education-school'), 9.5, 'bold');
    addText(section.querySelector('.education-date'), 9, 'italic');
    addText(section.querySelector('.education-degree'), 9);
    addText(section.querySelector('.education-gpa'), 9);
    addText(section.querySelector('.education-detail'), 9);
  });
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
