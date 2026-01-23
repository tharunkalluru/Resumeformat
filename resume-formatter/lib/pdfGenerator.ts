import jsPDF from 'jspdf';

/**
 * Generates a native text-based PDF (like Word/Docs output).
 * No images, no invisible text - just real, selectable, ATS-friendly text.
 */
export async function generatePDF(elementId: string = 'resume-preview', filename: string = 'resume.pdf'): Promise<void> {
  const resumeElement = document.getElementById(elementId);
  if (!resumeElement) {
    throw new Error('Resume preview element not found');
  }

  // Create PDF with letter size
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
    compress: true,
  });

  // Page dimensions in points (1 inch = 72 points)
  const PAGE_WIDTH = 612; // 8.5 inches
  const PAGE_HEIGHT = 792; // 11 inches
  const MARGIN_LEFT = 40;
  const MARGIN_RIGHT = 40;
  const MARGIN_TOP = 36;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

  let y = MARGIN_TOP; // Current Y position

  // Helper: Add text and return new Y position
  const addText = (
    text: string,
    x: number,
    fontSize: number,
    options: {
      fontStyle?: 'normal' | 'bold' | 'italic' | 'bolditalic';
      color?: [number, number, number];
      maxWidth?: number;
      align?: 'left' | 'center' | 'right';
    } = {}
  ): number => {
    const { fontStyle = 'normal', color = [0, 0, 0], maxWidth = CONTENT_WIDTH, align = 'left' } = options;
    
    pdf.setFont('helvetica', fontStyle);
    pdf.setFontSize(fontSize);
    pdf.setTextColor(color[0], color[1], color[2]);
    
    // Split text to fit width
    const lines = pdf.splitTextToSize(text, maxWidth);
    const lineHeight = fontSize * 1.3;
    
    lines.forEach((line: string, index: number) => {
      let textX = x;
      if (align === 'center') {
        const textWidth = pdf.getTextWidth(line);
        textX = (PAGE_WIDTH - textWidth) / 2;
      } else if (align === 'right') {
        const textWidth = pdf.getTextWidth(line);
        textX = PAGE_WIDTH - MARGIN_RIGHT - textWidth;
      }
      pdf.text(line, textX, y + (index * lineHeight));
    });
    
    return y + (lines.length * lineHeight);
  };

  // Helper: Add a horizontal line
  const addLine = (yPos: number, width: number = CONTENT_WIDTH): void => {
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(1);
    pdf.line(MARGIN_LEFT, yPos, MARGIN_LEFT + width, yPos);
  };

  // ========== EXTRACT DATA FROM DOM ==========
  
  // Name
  const nameEl = resumeElement.querySelector('.resume-name');
  const name = nameEl?.textContent?.trim() || '';

  // Contact info
  const contactItems: { icon: string; text: string; url?: string }[] = [];
  
  // LinkedIn
  const linkedinLink = resumeElement.querySelector('a[href*="linkedin"]') as HTMLAnchorElement;
  if (linkedinLink) {
    const text = linkedinLink.querySelector('.contact-item span:not(.contact-icon)')?.textContent?.trim();
    if (text) contactItems.push({ icon: 'in', text, url: linkedinLink.href });
  }
  
  // Portfolio
  const portfolioLink = resumeElement.querySelector('a[href*="tharunkalluru"]') as HTMLAnchorElement;
  if (portfolioLink) {
    const text = portfolioLink.querySelector('.contact-item span:not(.contact-icon)')?.textContent?.trim();
    if (text) contactItems.push({ icon: '◆', text, url: portfolioLink.href });
  }
  
  // Email & Phone (not in links)
  resumeElement.querySelectorAll('.contact-item').forEach(item => {
    if (item.closest('a')) return; // Skip if inside a link (already handled)
    const icon = item.querySelector('.contact-icon')?.textContent?.trim() || '';
    const text = item.querySelector('span:not(.contact-icon)')?.textContent?.trim() || '';
    if (text) contactItems.push({ icon, text });
  });

  // ========== RENDER NAME (CENTERED) ==========
  y = addText(name, MARGIN_LEFT, 20, { fontStyle: 'bold', align: 'center' });
  y += 8;

  // ========== RENDER CONTACT LINE (CENTERED) ==========
  const contactString = contactItems.map(c => `${c.icon} ${c.text}`).join('   •   ');
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  const contactWidth = pdf.getTextWidth(contactString);
  const contactX = (PAGE_WIDTH - contactWidth) / 2;
  pdf.text(contactString, contactX, y);
  
  // Add clickable links for LinkedIn and Portfolio
  let linkX = contactX;
  contactItems.forEach((item, index) => {
    const itemText = `${item.icon} ${item.text}`;
    const itemWidth = pdf.getTextWidth(itemText);
    
    if (item.url) {
      pdf.link(linkX, y - 9, itemWidth, 12, { url: item.url });
    }
    
    linkX += itemWidth;
    if (index < contactItems.length - 1) {
      linkX += pdf.getTextWidth('   •   ');
    }
  });
  
  y += 16;

  // ========== RENDER SECTIONS ==========
  const sections = resumeElement.querySelectorAll('.resume-section');
  
  sections.forEach((section) => {
    const sectionTitle = section.querySelector('.section-title')?.textContent?.trim() || '';
    
    // Section Title with underline
    y += 4;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(0, 0, 0);
    pdf.text(sectionTitle, MARGIN_LEFT, y);
    y += 8;
    addLine(y);
    y += 10;

    // ===== EXPERIENCE =====
    const jobEntries = section.querySelectorAll('.job-entry');
    jobEntries.forEach((job, jobIndex) => {
      // Job title line
      const title = job.querySelector('.job-title')?.textContent?.trim() || '';
      const company = job.querySelector('.job-company')?.textContent?.trim() || '';
      const location = job.querySelector('.job-location')?.textContent?.trim() || '';
      const dateRange = job.querySelector('.job-date')?.textContent?.trim() || '';
      
      const jobHeader = [title, company, location].filter(Boolean).join(' | ');
      
      // Job header (bold) on left, date (italic) on right
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9.5);
      pdf.text(jobHeader, MARGIN_LEFT, y);
      
      if (dateRange) {
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(9);
        pdf.setTextColor(51, 51, 51);
        const dateWidth = pdf.getTextWidth(dateRange);
        pdf.text(dateRange, PAGE_WIDTH - MARGIN_RIGHT - dateWidth, y);
      }
      
      y += 12;
      
      // Bullets
      const bullets = job.querySelectorAll('.resume-bullets li');
      bullets.forEach((bullet) => {
        const bulletText = bullet.textContent?.trim() || '';
        if (bulletText) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(9);
          pdf.setTextColor(0, 0, 0);
          
          // Add bullet point
          pdf.text('•', MARGIN_LEFT, y);
          
          // Add text with wrapping
          const textX = MARGIN_LEFT + 10;
          const textMaxWidth = CONTENT_WIDTH - 10;
          const lines = pdf.splitTextToSize(bulletText, textMaxWidth);
          const lineHeight = 11;
          
          lines.forEach((line: string, lineIndex: number) => {
            pdf.text(line, textX, y + (lineIndex * lineHeight));
          });
          
          y += lines.length * lineHeight + 2;
        }
      });
      
      // Add space between jobs
      if (jobIndex < jobEntries.length - 1) {
        y += 6;
      }
    });

    // ===== STARTUPS =====
    const startupEntries = section.querySelectorAll('.startup-entry');
    startupEntries.forEach((startup, index) => {
      const role = startup.querySelector('.startup-role')?.textContent?.trim() || '';
      const desc = startup.querySelector('.startup-desc')?.textContent?.trim() || '';
      
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(0, 0, 0);
      pdf.text(role, MARGIN_LEFT, y);
      
      if (desc) {
        const roleWidth = pdf.getTextWidth(role);
        pdf.setFont('helvetica', 'normal');
        pdf.text(' - ' + desc, MARGIN_LEFT + roleWidth, y);
      }
      
      y += 13;
      
      if (index < startupEntries.length - 1) {
        y += 2;
      }
    });

    // ===== SKILLS =====
    const skillLines = section.querySelectorAll('.skill-line');
    skillLines.forEach((skill, index) => {
      const label = skill.querySelector('.skill-label')?.textContent?.trim() || '';
      const content = skill.querySelector('.skill-content')?.textContent?.trim() || '';
      
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(0, 0, 0);
      pdf.text(label + ':', MARGIN_LEFT, y);
      
      const labelWidth = pdf.getTextWidth(label + ': ');
      pdf.setFont('helvetica', 'normal');
      
      // Wrap content if needed
      const contentMaxWidth = CONTENT_WIDTH - labelWidth;
      const lines = pdf.splitTextToSize(content, contentMaxWidth);
      const lineHeight = 11;
      
      lines.forEach((line: string, lineIndex: number) => {
        const xPos = lineIndex === 0 ? MARGIN_LEFT + labelWidth : MARGIN_LEFT;
        const width = lineIndex === 0 ? contentMaxWidth : CONTENT_WIDTH;
        pdf.text(line, xPos, y + (lineIndex * lineHeight));
      });
      
      y += lines.length * lineHeight + 2;
      
      if (index < skillLines.length - 1) {
        y += 1;
      }
    });

    // ===== EDUCATION =====
    const eduEntry = section.querySelector('.education-entry');
    if (eduEntry) {
      // School line
      const school = section.querySelector('.education-school')?.textContent?.trim() || '';
      const eduDate = section.querySelector('.education-date')?.textContent?.trim() || '';
      
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9.5);
      pdf.setTextColor(0, 0, 0);
      pdf.text(school, MARGIN_LEFT, y);
      
      if (eduDate) {
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(9);
        pdf.setTextColor(51, 51, 51);
        const dateWidth = pdf.getTextWidth(eduDate);
        pdf.text(eduDate, PAGE_WIDTH - MARGIN_RIGHT - dateWidth, y);
      }
      
      y += 12;
      
      // Degree and GPA line
      const degree = section.querySelector('.education-degree')?.textContent?.trim() || '';
      const gpa = section.querySelector('.education-gpa')?.textContent?.trim() || '';
      
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(0, 0, 0);
      pdf.text(degree, MARGIN_LEFT, y);
      
      if (gpa) {
        const gpaWidth = pdf.getTextWidth(gpa);
        pdf.text(gpa, PAGE_WIDTH - MARGIN_RIGHT - gpaWidth, y);
      }
      
      y += 12;
      
      // Coursework
      const coursework = section.querySelector('.education-detail')?.textContent?.trim() || '';
      if (coursework) {
        const lines = pdf.splitTextToSize(coursework, CONTENT_WIDTH);
        lines.forEach((line: string, index: number) => {
          pdf.text(line, MARGIN_LEFT, y + (index * 11));
        });
        y += lines.length * 11;
      }
    }
    
    // Add space after section
    y += 4;
  });

  // Save the PDF
  pdf.save(filename);
  console.log('[PDF] Generated native text PDF - fully ATS compatible!');
}
