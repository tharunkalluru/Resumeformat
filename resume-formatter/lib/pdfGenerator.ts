import jsPDF from 'jspdf';

/**
 * Generates a TEXT-based PDF that matches the preview exactly.
 * 
 * Approach: Measure actual element positions from the DOM and render
 * text at those exact coordinates in the PDF. This gives us:
 * 1. Real, selectable, ATS-parseable text
 * 2. Layout that matches the preview exactly
 * 3. No images, no invisible text - just a legitimate text PDF
 */
export async function generatePDF(elementId: string = 'resume-preview', filename: string = 'resume.pdf'): Promise<void> {
  const resumeElement = document.getElementById(elementId);
  if (!resumeElement) {
    throw new Error('Resume preview element not found');
  }

  // Create PDF - Letter size (8.5 x 11 inches = 612 x 792 points)
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
    compress: true,
  });

  // Get resume element dimensions for coordinate conversion
  const resumeRect = resumeElement.getBoundingClientRect();
  
  // PDF dimensions in points
  const PDF_WIDTH = 612;
  const PDF_HEIGHT = 792;
  
  // Scale factors to convert from screen pixels to PDF points
  const scaleX = PDF_WIDTH / resumeRect.width;
  const scaleY = PDF_HEIGHT / resumeRect.height;

  /**
   * Convert screen coordinates to PDF coordinates
   */
  const toPdfX = (screenX: number): number => {
    return (screenX - resumeRect.left) * scaleX;
  };
  
  const toPdfY = (screenY: number): number => {
    return (screenY - resumeRect.top) * scaleY;
  };

  /**
   * Check if a word (without punctuation) is a metric that should be bold
   * Matches: 40%, $5M, 60+, 400k, 2x, 100+, $5M+, etc.
   */
  const isMetricWord = (word: string): boolean => {
    // Strip leading/trailing punctuation for checking
    const cleanWord = word.replace(/^[^$\d]+|[^%KMBkmbxX+\d]+$/g, '');
    if (!cleanWord) return false;
    
    // Pattern: optional $, digits (with optional commas), optional decimal, optional suffix
    const metricPattern = /^\$?\d+(?:,\d{3})*(?:\.\d+)?[%KMBkmbxX+]*\+?$/;
    return metricPattern.test(cleanWord) && /\d/.test(cleanWord) && 
           // Must have a meaningful suffix or be a dollar amount to be considered a metric
           (/[%KMBkmbxX+]/.test(cleanWord) || /^\$/.test(cleanWord));
  };

  /**
   * Render a single line with bold metrics using word-by-word approach
   * This mimics how Word/Docs handle inline bold - spacing stays natural
   */
  const renderLineWithBoldMetrics = (line: string, startX: number, y: number, fontSize: number) => {
    // Split into words, preserving the original structure
    const words = line.split(' ');
    
    pdf.setFontSize(fontSize);
    pdf.setTextColor(0, 0, 0);
    
    // Calculate space width using normal font (consistent spacing)
    pdf.setFont('helvetica', 'normal');
    const spaceWidth = pdf.getTextWidth(' ');
    
    let currentX = startX;
    
    words.forEach((word, index) => {
      if (!word) {
        // Empty string from multiple spaces - just add space
        currentX += spaceWidth;
        return;
      }
      
      // Check if this word contains a metric
      const shouldBold = isMetricWord(word);
      
      // Set appropriate font
      pdf.setFont('helvetica', shouldBold ? 'bold' : 'normal');
      
      // Render the word
      pdf.text(word, currentX, y);
      
      // Move position by word width (measured with current font)
      currentX += pdf.getTextWidth(word);
      
      // Add space after word (except for last word)
      // Always use normal font space width for consistency
      if (index < words.length - 1) {
        currentX += spaceWidth;
      }
    });
  };

  /**
   * Calculate line width with mixed fonts (for proper line wrapping)
   */
  const getLineWidthWithMetrics = (line: string, fontSize: number): number => {
    const words = line.split(' ');
    pdf.setFontSize(fontSize);
    pdf.setFont('helvetica', 'normal');
    const spaceWidth = pdf.getTextWidth(' ');
    
    let width = 0;
    words.forEach((word, index) => {
      if (!word) {
        width += spaceWidth;
        return;
      }
      
      const shouldBold = isMetricWord(word);
      pdf.setFont('helvetica', shouldBold ? 'bold' : 'normal');
      width += pdf.getTextWidth(word);
      
      if (index < words.length - 1) {
        width += spaceWidth;
      }
    });
    
    return width;
  };

  /**
   * Split text into lines considering mixed bold/normal fonts
   */
  const splitTextWithMetrics = (text: string, maxWidth: number, fontSize: number): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    
    pdf.setFontSize(fontSize);
    pdf.setFont('helvetica', 'normal');
    const spaceWidth = pdf.getTextWidth(' ');
    
    words.forEach(word => {
      if (!word) return;
      
      const testLine = currentLine ? currentLine + ' ' + word : word;
      const testWidth = getLineWidthWithMetrics(testLine, fontSize);
      
      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    });
    
    if (currentLine) {
      lines.push(currentLine);
    }
    
    return lines;
  };

  /**
   * Get font style from computed style
   */
  const getFontStyle = (computedStyle: CSSStyleDeclaration): 'normal' | 'bold' | 'italic' | 'bolditalic' => {
    const weight = computedStyle.fontWeight;
    const style = computedStyle.fontStyle;
    const isBold = weight === 'bold' || parseInt(weight) >= 600;
    const isItalic = style === 'italic';
    
    if (isBold && isItalic) return 'bolditalic';
    if (isBold) return 'bold';
    if (isItalic) return 'italic';
    return 'normal';
  };

  /**
   * Convert pixel font size to points
   */
  const pxToPt = (px: number): number => {
    return px * 72 / 96; // 96 DPI standard
  };

  /**
   * Parse RGB color string to array
   */
  const parseColor = (colorStr: string): [number, number, number] => {
    const match = colorStr.match(/\d+/g);
    if (match && match.length >= 3) {
      return [parseInt(match[0]), parseInt(match[1]), parseInt(match[2])];
    }
    return [0, 0, 0]; // Default black
  };

  /**
   * Render a text element to PDF at its exact position
   */
  const renderTextElement = (element: Element, text?: string) => {
    const el = element as HTMLElement;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    
    const content = text || el.textContent?.trim() || '';
    if (!content) return;
    
    // Get position in PDF coordinates
    const x = toPdfX(rect.left);
    const y = toPdfY(rect.top);
    
    // Get font properties
    const fontSize = pxToPt(parseFloat(style.fontSize));
    const fontStyle = getFontStyle(style);
    const color = parseColor(style.color);
    
    // Set PDF font properties
    pdf.setFont('helvetica', fontStyle);
    pdf.setFontSize(fontSize);
    pdf.setTextColor(color[0], color[1], color[2]);
    
    // Calculate max width for text wrapping
    const maxWidth = rect.width * scaleX;
    
    // For single-line elements, render directly
    // For multi-line, use splitTextToSize
    if (el.offsetHeight <= parseFloat(style.lineHeight) * 1.5) {
      // Single line - render at baseline position
      const baseline = y + fontSize * 0.85; // Approximate baseline
      pdf.text(content, x, baseline);
    } else {
      // Multi-line - wrap text
      const lines = pdf.splitTextToSize(content, maxWidth);
      const lineHeight = fontSize * 1.35;
      const baseline = y + fontSize * 0.85;
      
      lines.forEach((line: string, index: number) => {
        pdf.text(line, x, baseline + (index * lineHeight));
      });
    }
  };

  /**
   * Render text with specific positioning (for flex layouts)
   */
  const renderTextAt = (
    text: string, 
    rect: DOMRect, 
    style: CSSStyleDeclaration,
    align: 'left' | 'right' | 'center' = 'left'
  ) => {
    if (!text.trim()) return;
    
    const fontSize = pxToPt(parseFloat(style.fontSize));
    const fontStyle = getFontStyle(style);
    const color = parseColor(style.color);
    
    pdf.setFont('helvetica', fontStyle);
    pdf.setFontSize(fontSize);
    pdf.setTextColor(color[0], color[1], color[2]);
    
    const y = toPdfY(rect.top) + fontSize * 0.85;
    let x = toPdfX(rect.left);
    
    if (align === 'right') {
      const textWidth = pdf.getTextWidth(text);
      x = toPdfX(rect.right) - textWidth;
    } else if (align === 'center') {
      const textWidth = pdf.getTextWidth(text);
      x = toPdfX(rect.left + rect.width / 2) - textWidth / 2;
    }
    
    pdf.text(text, x, y);
  };

  /**
   * Draw a horizontal line below section title
   */
  const drawSectionUnderline = (element: Element, textY: number, fontSize: number) => {
    const el = element as HTMLElement;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    
    const borderWidth = parseFloat(style.borderBottomWidth) || 1;
    const borderColor = parseColor(style.borderBottomColor);
    
    // Draw line just below the text (5pt gap from baseline to match preview)
    const lineY = textY + 5;
    
    pdf.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
    pdf.setLineWidth(borderWidth * scaleY);
    pdf.line(toPdfX(rect.left), lineY, toPdfX(rect.right), lineY);
  };

  // ========== RENDER RESUME CONTENT ==========

  // 1. NAME (centered)
  const nameEl = resumeElement.querySelector('.resume-name');
  if (nameEl) {
    const rect = nameEl.getBoundingClientRect();
    const style = window.getComputedStyle(nameEl);
    const text = nameEl.textContent?.trim() || '';
    
    const fontSize = pxToPt(parseFloat(style.fontSize));
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(fontSize);
    pdf.setTextColor(0, 0, 0);
    
    const textWidth = pdf.getTextWidth(text);
    const x = (PDF_WIDTH - textWidth) / 2;
    const y = toPdfY(rect.top) + fontSize * 0.85;
    
    pdf.text(text, x, y);
  }

  // 2. CONTACT LINE (centered with bullet points)
  const contactLine = resumeElement.querySelector('.contact-line');
  if (contactLine) {
    const rect = contactLine.getBoundingClientRect();
    const style = window.getComputedStyle(contactLine);
    
    // Get all contact items - just the text values, no symbols
    const items: { text: string; url?: string }[] = [];
    
    contactLine.querySelectorAll('.contact-item').forEach(item => {
      const text = item.querySelector('span:not(.contact-icon)')?.textContent?.trim() || '';
      const link = item.closest('a') as HTMLAnchorElement;
      
      if (text) {
        items.push({
          text: text,
          url: link?.href
        });
      }
    });
    
    // Build contact string with bullet separators (leading bullet only, no trailing)
    const fontSize = pxToPt(parseFloat(style.fontSize));
    const bulletFontSize = fontSize * 1.3; // Larger bullets
    
    // Calculate total width for centering
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(bulletFontSize);
    const bulletChar = '•';
    const bulletWidth = pdf.getTextWidth(bulletChar);
    pdf.setFontSize(fontSize);
    // Asymmetric spacing: more space BEFORE bullet (after prev item), less AFTER bullet (before next item)
    // This groups each bullet with its following item, creating clear visual sections
    const spaceBeforeBullet = pdf.getTextWidth('      '); // 6 spaces - larger gap after item
    const spaceAfterBullet = pdf.getTextWidth('  ');      // 2 spaces - bullet close to its item
    
    let totalWidth = bulletWidth + spaceAfterBullet; // Leading bullet + small space
    items.forEach((item, i) => {
      totalWidth += pdf.getTextWidth(item.text);
      if (i < items.length - 1) {
        totalWidth += spaceBeforeBullet + bulletWidth + spaceAfterBullet; // large space + bullet + small space
      }
    });
    
    // Render centered
    const startX = (PDF_WIDTH - totalWidth) / 2;
    const textY = toPdfY(rect.top) + fontSize * 0.85;
    // Adjust bullet Y position to be vertically centered with text
    // Larger bullet needs more downward adjustment
    const bulletY = textY + (bulletFontSize - fontSize) * 0.35;
    let currentX = startX;
    
    pdf.setTextColor(0, 0, 0);
    
    // Render leading bullet (larger, vertically centered)
    pdf.setFontSize(bulletFontSize);
    pdf.text(bulletChar, currentX, bulletY);
    currentX += bulletWidth + spaceAfterBullet; // Small space after leading bullet
    
    // Render items with bullet separators
    items.forEach((item, i) => {
      // Render item text
      pdf.setFontSize(fontSize);
      pdf.text(item.text, currentX, textY);
      
      // Add hyperlink if exists
      if (item.url) {
        const itemWidth = pdf.getTextWidth(item.text);
        pdf.link(currentX, textY - fontSize, itemWidth, fontSize * 1.2, { url: item.url });
      }
      
      currentX += pdf.getTextWidth(item.text);
      
      // Add bullet separator (except after last item)
      if (i < items.length - 1) {
        currentX += spaceBeforeBullet; // Large space after item
        pdf.setFontSize(bulletFontSize);
        pdf.text(bulletChar, currentX, bulletY);
        currentX += bulletWidth + spaceAfterBullet; // Small space before next item
      }
    });
  }

  // 3. SECTIONS
  resumeElement.querySelectorAll('.resume-section').forEach(section => {
    // Section Title with underline
    const titleEl = section.querySelector('.section-title');
    if (titleEl) {
      const rect = titleEl.getBoundingClientRect();
      const style = window.getComputedStyle(titleEl);
      const text = titleEl.textContent?.trim() || '';
      
      const fontSize = pxToPt(parseFloat(style.fontSize));
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(fontSize);
      pdf.setTextColor(0, 0, 0);
      
      const x = toPdfX(rect.left);
      const y = toPdfY(rect.top) + fontSize * 0.85;
      
      pdf.text(text, x, y);
      
      // Draw underline closer to the text
      drawSectionUnderline(titleEl, y, fontSize);
    }

    // JOB ENTRIES
    section.querySelectorAll('.job-entry').forEach(job => {
      // Job header (title line + date)
      const headerEl = job.querySelector('.job-header');
      if (headerEl) {
        const titleLineEl = job.querySelector('.job-title-line');
        const dateEl = job.querySelector('.job-date');
        
        if (titleLineEl) {
          const rect = titleLineEl.getBoundingClientRect();
          const style = window.getComputedStyle(titleLineEl);
          const text = titleLineEl.textContent?.trim() || '';
          
          const fontSize = pxToPt(parseFloat(style.fontSize));
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(fontSize);
          pdf.setTextColor(0, 0, 0);
          
          const x = toPdfX(rect.left);
          const y = toPdfY(rect.top) + fontSize * 0.85;
          
          pdf.text(text, x, y);
        }
        
        if (dateEl) {
          const rect = dateEl.getBoundingClientRect();
          const style = window.getComputedStyle(dateEl);
          const text = dateEl.textContent?.trim() || '';
          
          const fontSize = pxToPt(parseFloat(style.fontSize));
          pdf.setFont('helvetica', 'italic');
          pdf.setFontSize(fontSize);
          pdf.setTextColor(51, 51, 51);
          
          // Right-align the date
          const textWidth = pdf.getTextWidth(text);
          const x = toPdfX(rect.right) - textWidth;
          const y = toPdfY(rect.top) + fontSize * 0.85;
          
          pdf.text(text, x, y);
        }
      }
      
      // Bullets - with bold metrics (word-by-word rendering for natural spacing)
      job.querySelectorAll('.resume-bullets li').forEach(bullet => {
        const rect = bullet.getBoundingClientRect();
        const style = window.getComputedStyle(bullet);
        const text = bullet.textContent?.trim() || '';
        
        if (!text) return;
        
        const fontSize = pxToPt(parseFloat(style.fontSize));
        const bulletFontSize = fontSize * 1.3; // Larger bullet point
        pdf.setTextColor(0, 0, 0);
        
        // Get positions
        const x = toPdfX(rect.left);
        const textY = toPdfY(rect.top) + fontSize * 0.85;
        // Adjust bullet Y position to be vertically centered with text
        const bulletY = textY + (bulletFontSize - fontSize) * 0.35;
        
        // Render bullet point separately with larger size, vertically centered
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(bulletFontSize);
        const bulletChar = '•';
        pdf.text(bulletChar, x, bulletY);
        const bulletWidth = pdf.getTextWidth(bulletChar + ' ');
        
        // Calculate text start position after bullet
        const textStartX = x + bulletWidth;
        const textMaxWidth = (rect.width * scaleX) - bulletWidth;
        
        // Split text into lines accounting for mixed font widths
        const lines = splitTextWithMetrics(text, textMaxWidth, fontSize);
        const lineHeight = fontSize * 1.35;
        
        // Render each line with bold metrics using word-by-word approach
        lines.forEach((line: string, index: number) => {
          const lineY = textY + (index * lineHeight);
          const lineX = index === 0 ? textStartX : x + bulletWidth; // First line after bullet, others indented
          renderLineWithBoldMetrics(line, lineX, lineY, fontSize);
        });
      });
    });

    // STARTUP ENTRIES - with bold metrics in description
    section.querySelectorAll('.startup-entry').forEach(startup => {
      const rect = startup.getBoundingClientRect();
      const style = window.getComputedStyle(startup);
      
      const roleEl = startup.querySelector('.startup-role');
      const descEl = startup.querySelector('.startup-desc');
      
      const fontSize = pxToPt(parseFloat(style.fontSize));
      const y = toPdfY(rect.top) + fontSize * 0.85;
      let x = toPdfX(rect.left);
      
      if (roleEl) {
        const role = roleEl.textContent?.trim() || '';
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(fontSize);
        pdf.setTextColor(0, 0, 0);
        pdf.text(role, x, y);
        x += pdf.getTextWidth(role);
      }
      
      if (descEl) {
        const desc = descEl.textContent?.trim() || '';
        // Render " - " prefix first
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(fontSize);
        pdf.text(' - ', x, y);
        x += pdf.getTextWidth(' - ');
        
        // Render description with bold metrics
        renderLineWithBoldMetrics(desc, x, y, fontSize);
      }
    });

    // SKILL LINES
    section.querySelectorAll('.skill-line').forEach(skill => {
      const rect = skill.getBoundingClientRect();
      const style = window.getComputedStyle(skill);
      
      const labelEl = skill.querySelector('.skill-label');
      const contentEl = skill.querySelector('.skill-content');
      
      const fontSize = pxToPt(parseFloat(style.fontSize));
      const y = toPdfY(rect.top) + fontSize * 0.85;
      let x = toPdfX(rect.left);
      
      if (labelEl) {
        const label = labelEl.textContent?.trim() || '';
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(fontSize);
        pdf.setTextColor(0, 0, 0);
        pdf.text(label + ': ', x, y);
        x += pdf.getTextWidth(label + ': ');
      }
      
      if (contentEl) {
        const content = contentEl.textContent?.trim() || '';
        pdf.setFont('helvetica', 'normal');
        
        // Handle wrapping for long skill content
        const maxWidth = toPdfX(rect.right) - x;
        const lines = pdf.splitTextToSize(content, maxWidth);
        const lineHeight = fontSize * 1.35;
        
        lines.forEach((line: string, index: number) => {
          if (index === 0) {
            pdf.text(line, x, y);
          } else {
            pdf.text(line, toPdfX(rect.left), y + (index * lineHeight));
          }
        });
      }
    });

    // EDUCATION
    const eduEntry = section.querySelector('.education-entry');
    if (eduEntry) {
      // School line
      const schoolEl = section.querySelector('.education-school');
      const eduDateEl = section.querySelector('.education-date');
      
      if (schoolEl) {
        const rect = schoolEl.getBoundingClientRect();
        const style = window.getComputedStyle(schoolEl);
        const text = schoolEl.textContent?.trim() || '';
        
        const fontSize = pxToPt(parseFloat(style.fontSize));
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(fontSize);
        pdf.setTextColor(0, 0, 0);
        
        const x = toPdfX(rect.left);
        const y = toPdfY(rect.top) + fontSize * 0.85;
        
        pdf.text(text, x, y);
      }
      
      if (eduDateEl) {
        const rect = eduDateEl.getBoundingClientRect();
        const style = window.getComputedStyle(eduDateEl);
        const text = eduDateEl.textContent?.trim() || '';
        
        const fontSize = pxToPt(parseFloat(style.fontSize));
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(fontSize);
        pdf.setTextColor(51, 51, 51);
        
        const textWidth = pdf.getTextWidth(text);
        const x = toPdfX(rect.right) - textWidth;
        const y = toPdfY(rect.top) + fontSize * 0.85;
        
        pdf.text(text, x, y);
      }
      
      // Degree and GPA row
      const degreeEl = section.querySelector('.education-degree');
      const gpaEl = section.querySelector('.education-gpa');
      
      if (degreeEl) {
        const rect = degreeEl.getBoundingClientRect();
        const style = window.getComputedStyle(degreeEl);
        const text = degreeEl.textContent?.trim() || '';
        
        const fontSize = pxToPt(parseFloat(style.fontSize));
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(fontSize);
        pdf.setTextColor(0, 0, 0);
        
        const x = toPdfX(rect.left);
        const y = toPdfY(rect.top) + fontSize * 0.85;
        
        pdf.text(text, x, y);
      }
      
      if (gpaEl) {
        const rect = gpaEl.getBoundingClientRect();
        const style = window.getComputedStyle(gpaEl);
        const text = gpaEl.textContent?.trim() || '';
        
        const fontSize = pxToPt(parseFloat(style.fontSize));
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(fontSize);
        pdf.setTextColor(0, 0, 0);
        
        const textWidth = pdf.getTextWidth(text);
        const x = toPdfX(rect.right) - textWidth;
        const y = toPdfY(rect.top) + fontSize * 0.85;
        
        pdf.text(text, x, y);
      }
      
      // Coursework detail
      const detailEl = section.querySelector('.education-detail');
      if (detailEl) {
        const rect = detailEl.getBoundingClientRect();
        const style = window.getComputedStyle(detailEl);
        const text = detailEl.textContent?.trim() || '';
        
        const fontSize = pxToPt(parseFloat(style.fontSize));
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(fontSize);
        pdf.setTextColor(0, 0, 0);
        
        const x = toPdfX(rect.left);
        const y = toPdfY(rect.top) + fontSize * 0.85;
        const maxWidth = rect.width * scaleX;
        
        const lines = pdf.splitTextToSize(text, maxWidth);
        const lineHeight = fontSize * 1.35;
        
        lines.forEach((line: string, index: number) => {
          pdf.text(line, x, y + (index * lineHeight));
        });
      }
    }
  });

  // Save the PDF
  pdf.save(filename);
  console.log('[PDF] Generated text-based PDF with DOM-measured positions!');
}
