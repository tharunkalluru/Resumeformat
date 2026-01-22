import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

/**
 * Generates a PDF that exactly matches the preview on screen.
 * WYSIWYG - What You See Is What You Get
 * 
 * Key: Apply ALL styles as inline styles since html2canvas doesn't
 * reliably capture CSS computed styles.
 */
export async function generatePDF(elementId: string = 'resume-preview', filename: string = 'resume.pdf'): Promise<void> {
  const resumeElement = document.getElementById(elementId);
  if (!resumeElement) {
    throw new Error('Resume preview element not found');
  }

  // Get the computed styles from the preview (these include the dynamic spacing)
  const computedStyle = window.getComputedStyle(resumeElement);
  
  // Get CSS variable values that were dynamically calculated
  const sectionGap = computedStyle.getPropertyValue('--section-gap').trim() || '8px';
  const jobGap = computedStyle.getPropertyValue('--job-gap').trim() || '6px';
  const bulletGap = computedStyle.getPropertyValue('--bullet-gap').trim() || '1px';
  
  // Get the current transform (includes any scaling applied by dynamic algorithm)
  const currentTransform = computedStyle.transform;

  console.log('[PDF] Capturing with spacing:', { sectionGap, jobGap, bulletGap, currentTransform });

  // Clone the element
  const clone = resumeElement.cloneNode(true) as HTMLElement;
  clone.id = 'resume-clone-for-pdf';
  
  // Remove contenteditable attributes
  clone.querySelectorAll('[contenteditable]').forEach(el => {
    el.removeAttribute('contenteditable');
    el.classList.remove('editable-field');
  });

  // Position off-screen for rendering
  // IMPORTANT: Do NOT apply transform to clone - it causes cropping issues
  // Instead, we'll let the dynamic spacing handle fitting
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

  // ====== APPLY ALL INLINE STYLES EXPLICITLY ======
  // This ensures html2canvas sees the exact styles we want

  // HEADER
  const header = clone.querySelector('.resume-header') as HTMLElement;
  if (header) {
    header.style.cssText = `
      text-align: center;
      margin: 0 0 10px 0;
      padding: 0;
    `;
  }

  // NAME
  const name = clone.querySelector('.resume-name') as HTMLElement;
  if (name) {
    name.style.cssText = `
      font-family: Calibri, 'Segoe UI', Arial, sans-serif;
      font-size: 20pt;
      font-weight: bold;
      color: #000000;
      margin: 0 0 6px 0;
      padding: 0;
      display: block;
      text-align: center;
    `;
  }

  // CONTACT LINE
  const contactLine = clone.querySelector('.contact-line') as HTMLElement;
  if (contactLine) {
    contactLine.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: baseline;
      gap: 12px;
      font-family: Calibri, 'Segoe UI', Arial, sans-serif;
      font-size: 9pt;
      color: #333333;
      margin: 0;
      padding: 0;
    `;
  }

  // CONTACT LINKS (LinkedIn, Portfolio)
  const contactLinks = clone.querySelectorAll('.contact-link') as NodeListOf<HTMLElement>;
  contactLinks.forEach(link => {
    link.style.cssText = `
      color: inherit;
      text-decoration: none;
    `;
  });

  // CONTACT ITEMS
  const contactItems = clone.querySelectorAll('.contact-item') as NodeListOf<HTMLElement>;
  contactItems.forEach(item => {
    item.style.cssText = `
      display: inline-flex;
      align-items: baseline;
      gap: 3px;
    `;
  });

  // CONTACT ICONS - All icons on same baseline
  const contactIcons = clone.querySelectorAll('.contact-icon') as NodeListOf<HTMLElement>;
  contactIcons.forEach(icon => {
    // Base style - using inline-block for consistent baseline alignment
    const baseStyle = `
      font-family: Arial, Helvetica, sans-serif;
      font-weight: bold;
      color: #000000;
      display: inline-block;
      width: 14px;
      height: 14px;
      line-height: 14px;
      text-align: center;
      vertical-align: baseline;
      flex-shrink: 0;
    `;
    
    // Apply individual sizes based on icon type - all on same baseline
    if (icon.classList.contains('icon-linkedin')) {
      icon.style.cssText = baseStyle + 'font-size: 9pt;';
    } else if (icon.classList.contains('icon-web')) {
      icon.style.cssText = baseStyle + 'font-size: 8pt; color: #000000;';
    } else if (icon.classList.contains('icon-email')) {
      icon.style.cssText = baseStyle + 'font-size: 7pt;';
    } else if (icon.classList.contains('icon-phone')) {
      icon.style.cssText = baseStyle + 'font-size: 9pt;';
    } else {
      icon.style.cssText = baseStyle + 'font-size: 9pt;';
    }
  });

  // SECTIONS
  const sections = clone.querySelectorAll('.resume-section') as NodeListOf<HTMLElement>;
  sections.forEach(section => {
    section.style.cssText = `
      margin-top: ${sectionGap};
      padding: 0;
    `;
  });

  // SECTION TITLES - Critical: padding-bottom creates gap before underline
  const sectionTitles = clone.querySelectorAll('.section-title') as NodeListOf<HTMLElement>;
  sectionTitles.forEach(title => {
    title.style.cssText = `
      font-family: Calibri, 'Segoe UI', Arial, sans-serif;
      font-size: 10pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #000000;
      padding: 0 0 8px 0;
      border-bottom: 1.5px solid #000000;
      margin: 0 0 8px 0;
      display: block;
      text-align: left;
    `;
  });

  // JOB ENTRIES
  const jobEntries = clone.querySelectorAll('.job-entry') as NodeListOf<HTMLElement>;
  jobEntries.forEach((entry, index, arr) => {
    const isLast = index === arr.length - 1;
    entry.style.cssText = `
      margin: 0 0 ${isLast ? '0' : jobGap} 0;
      padding: 0;
    `;
  });

  // JOB HEADERS
  const jobHeaders = clone.querySelectorAll('.job-header') as NodeListOf<HTMLElement>;
  jobHeaders.forEach(header => {
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      margin: 0 0 3px 0;
      padding: 0;
    `;
  });

  // JOB TITLE LINES
  const jobTitleLines = clone.querySelectorAll('.job-title-line') as NodeListOf<HTMLElement>;
  jobTitleLines.forEach(line => {
    line.style.cssText = `
      font-family: Calibri, 'Segoe UI', Arial, sans-serif;
      font-size: 9.5pt;
      color: #000000;
      text-align: left;
    `;
  });

  // JOB TITLES (bold)
  const jobTitles = clone.querySelectorAll('.job-title') as NodeListOf<HTMLElement>;
  jobTitles.forEach(title => {
    title.style.fontWeight = 'bold';
  });

  // JOB DATES
  const jobDates = clone.querySelectorAll('.job-date') as NodeListOf<HTMLElement>;
  jobDates.forEach(date => {
    date.style.cssText = `
      font-family: Calibri, 'Segoe UI', Arial, sans-serif;
      font-size: 9pt;
      color: #333333;
      font-style: italic;
      white-space: nowrap;
      flex-shrink: 0;
      text-align: right;
    `;
  });

  // BULLET LISTS
  const bulletLists = clone.querySelectorAll('.resume-bullets') as NodeListOf<HTMLElement>;
  bulletLists.forEach(list => {
    list.style.cssText = `
      margin: 3px 0 0 0;
      padding: 0 0 0 12px;
      list-style: none;
    `;
  });

  // BULLET ITEMS
  const bulletItems = clone.querySelectorAll('.resume-bullets li') as NodeListOf<HTMLElement>;
  bulletItems.forEach((bullet, index, arr) => {
    const parent = bullet.parentElement;
    const isLast = parent ? bullet === parent.lastElementChild : index === arr.length - 1;
    bullet.style.cssText = `
      font-family: Calibri, 'Segoe UI', Arial, sans-serif;
      font-size: 9pt;
      line-height: 1.45;
      margin: 0 0 ${isLast ? '0' : bulletGap} 0;
      padding: 0 0 0 0;
      position: relative;
      color: #000000;
    `;
  });

  // EDUCATION HEADERS
  const eduHeaders = clone.querySelectorAll('.education-header') as NodeListOf<HTMLElement>;
  eduHeaders.forEach(header => {
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 10px;
      margin: 0;
      padding: 0;
    `;
  });

  // EDUCATION SCHOOLS
  const eduSchools = clone.querySelectorAll('.education-school') as NodeListOf<HTMLElement>;
  eduSchools.forEach(school => {
    school.style.cssText = `
      font-family: Calibri, 'Segoe UI', Arial, sans-serif;
      font-size: 9.5pt;
      font-weight: bold;
      color: #000000;
      text-align: left;
    `;
  });

  // EDUCATION DATES
  const eduDates = clone.querySelectorAll('.education-date') as NodeListOf<HTMLElement>;
  eduDates.forEach(date => {
    date.style.cssText = `
      font-family: Calibri, 'Segoe UI', Arial, sans-serif;
      font-size: 9pt;
      color: #333333;
      font-style: italic;
      white-space: nowrap;
      flex-shrink: 0;
      text-align: right;
    `;
  });

  // EDUCATION DEGREE ROWS
  const eduDegreeRows = clone.querySelectorAll('.education-degree-row') as NodeListOf<HTMLElement>;
  eduDegreeRows.forEach(row => {
    row.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin: 4px 0 0 0;
      padding: 0;
    `;
  });

  // EDUCATION DEGREES
  const eduDegrees = clone.querySelectorAll('.education-degree') as NodeListOf<HTMLElement>;
  eduDegrees.forEach(degree => {
    degree.style.cssText = `
      font-family: Calibri, 'Segoe UI', Arial, sans-serif;
      font-size: 9pt;
      line-height: 1.45;
      color: #000000;
      text-align: left;
      flex: 1;
    `;
  });

  // EDUCATION GPAs
  const eduGpas = clone.querySelectorAll('.education-gpa') as NodeListOf<HTMLElement>;
  eduGpas.forEach(gpa => {
    gpa.style.cssText = `
      font-family: Calibri, 'Segoe UI', Arial, sans-serif;
      font-size: 9pt;
      line-height: 1.45;
      color: #000000;
      text-align: right;
      white-space: nowrap;
      flex-shrink: 0;
    `;
  });

  // EDUCATION DETAILS
  const eduDetails = clone.querySelectorAll('.education-detail') as NodeListOf<HTMLElement>;
  eduDetails.forEach(detail => {
    detail.style.cssText = `
      font-family: Calibri, 'Segoe UI', Arial, sans-serif;
      font-size: 9pt;
      margin: 3px 0 0 0;
      padding: 0;
      line-height: 1.45;
      color: #000000;
    `;
  });

  // STARTUP ENTRIES
  const startupEntries = clone.querySelectorAll('.startup-entry') as NodeListOf<HTMLElement>;
  startupEntries.forEach((entry, index, arr) => {
    const isLast = index === arr.length - 1;
    entry.style.cssText = `
      font-family: Calibri, 'Segoe UI', Arial, sans-serif;
      font-size: 9pt;
      margin: 0 0 ${isLast ? '0' : '5px'} 0;
      padding: 0;
      line-height: 1.45;
      color: #000000;
    `;
  });

  // STARTUP ROLES (bold)
  const startupRoles = clone.querySelectorAll('.startup-role') as NodeListOf<HTMLElement>;
  startupRoles.forEach(role => {
    role.style.fontWeight = 'bold';
  });

  // SKILL LINES
  const skillLines = clone.querySelectorAll('.skill-line') as NodeListOf<HTMLElement>;
  skillLines.forEach((line, index, arr) => {
    const isLast = index === arr.length - 1;
    line.style.cssText = `
      font-family: Calibri, 'Segoe UI', Arial, sans-serif;
      font-size: 9pt;
      margin: 0 0 ${isLast ? '0' : '5px'} 0;
      padding: 0;
      line-height: 1.45;
      color: #000000;
    `;
  });

  // SKILL LABELS (bold)
  const skillLabels = clone.querySelectorAll('.skill-label') as NodeListOf<HTMLElement>;
  skillLabels.forEach(label => {
    label.style.fontWeight = 'bold';
  });

  // BOLD METRICS
  const boldElements = clone.querySelectorAll('strong') as NodeListOf<HTMLElement>;
  boldElements.forEach(el => {
    el.style.fontWeight = 'bold';
    el.style.color = '#000000';
  });

  document.body.appendChild(clone);

  // Wait for styles to apply and fonts to load
  await new Promise(resolve => setTimeout(resolve, 200));

  try {
    // Generate canvas at maximum resolution for the sharpest possible text
    // Scale 4 = 300+ DPI equivalent, professional print quality
    const canvas = await html2canvas(clone, {
      scale: 4,
      useCORS: true,
      logging: false,
      width: 816,
      height: 1056,
      backgroundColor: '#ffffff',
      windowWidth: 816,
      windowHeight: 1056,
      imageTimeout: 0,
      removeContainer: false,
    });

    // Create PDF with compression enabled
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'in',
      format: 'letter',
      compress: true,
      putOnlyUsedFonts: true,
      floatPrecision: 16,
    });

    // Use PNG for lossless, razor-sharp text
    const imgData = canvas.toDataURL('image/png');
    
    // Add image with SLOW compression for best quality
    pdf.addImage(imgData, 'PNG', 0, 0, 8.5, 11, undefined, 'SLOW');

    // Add clickable hyperlinks for LinkedIn and Portfolio
    // These need to be added as annotations on top of the image
    const linkedinLink = resumeElement.querySelector('a[href*="linkedin"]') as HTMLAnchorElement;
    const portfolioLink = resumeElement.querySelector('a[href*="tharunkalluru.com"]') as HTMLAnchorElement;
    
    // Page dimensions
    const PAGE_WIDTH = 8.5; // inches
    const PAGE_HEIGHT = 11; // inches
    const DPI = 96;
    
    if (linkedinLink) {
      // Get bounding box of the link
      const rect = linkedinLink.getBoundingClientRect();
      const resumeRect = resumeElement.getBoundingClientRect();
      
      // Calculate position in pixels relative to resume top-left
      const xPx = rect.left - resumeRect.left;
      const yPx = rect.top - resumeRect.top;
      const widthPx = rect.width;
      const heightPx = rect.height;
      
      // Convert to inches (816px wide = 8.5in, so ratio is 8.5/816)
      const x = (xPx / 816) * PAGE_WIDTH;
      const y = (yPx / 1056) * PAGE_HEIGHT;
      const width = (widthPx / 816) * PAGE_WIDTH;
      const height = (heightPx / 1056) * PAGE_HEIGHT;
      
      // Add clickable link annotation
      pdf.link(x, y, width, height, { url: linkedinLink.href });
      console.log('[PDF] Added LinkedIn link:', linkedinLink.href);
      console.log('  Position (inches):', { x: x.toFixed(3), y: y.toFixed(3), width: width.toFixed(3), height: height.toFixed(3) });
    }
    
    if (portfolioLink) {
      const rect = portfolioLink.getBoundingClientRect();
      const resumeRect = resumeElement.getBoundingClientRect();
      
      const xPx = rect.left - resumeRect.left;
      const yPx = rect.top - resumeRect.top;
      const widthPx = rect.width;
      const heightPx = rect.height;
      
      const x = (xPx / 816) * PAGE_WIDTH;
      const y = (yPx / 1056) * PAGE_HEIGHT;
      const width = (widthPx / 816) * PAGE_WIDTH;
      const height = (heightPx / 1056) * PAGE_HEIGHT;
      
      pdf.link(x, y, width, height, { url: portfolioLink.href });
      console.log('[PDF] Added Portfolio link:', portfolioLink.href);
      console.log('  Position (inches):', { x: x.toFixed(3), y: y.toFixed(3), width: width.toFixed(3), height: height.toFixed(3) });
    }

    // Save the PDF
    pdf.save(filename);
    
    console.log('[PDF] Generated successfully! Maximum quality with clickable links.');
  } finally {
    // Clean up
    document.body.removeChild(clone);
  }
}
