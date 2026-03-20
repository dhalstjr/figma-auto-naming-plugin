async function main() {
  try {
    const selection = figma.currentPage.selection;
    if (
      selection.length === 0 || 
      !(selection[0].type === "FRAME" || selection[0].type === "COMPONENT" || selection[0].type === "INSTANCE")
    ) {
      figma.notify("기준이 되는 프레임이나 컴포넌트를 선택해 주세요.", { error: true });
      figma.closePlugin();
      return;
    }

    const targetFrame = selection[0];
    const isFormatted = targetFrame.findOne(n => n.name.startsWith("#Text") || n.name.startsWith("@Image") || n.name.startsWith("Layout_"));
    
    if (!isFormatted) {
      figma.notify("초기 템플릿 1단계 자동 세팅을 진행합니다...");
      await runFormatting(targetFrame);
    }
    
    openUI(targetFrame);

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    figma.notify("오류가 발생했습니다: " + errorMsg, { error: true });
    console.error("Plugin crashed:", err);
    figma.closePlugin(); 
  }
}

async function runFormatting(targetFrame) {
    function sortByCoordinates(a, b) {
      const yA = a.absoluteBoundingBox ? a.absoluteBoundingBox.y : a.y;
      const yB = b.absoluteBoundingBox ? b.absoluteBoundingBox.y : b.y;
      if (Math.abs(yA - yB) > 10) return yA - yB;
      const xA = a.absoluteBoundingBox ? a.absoluteBoundingBox.x : a.x;
      const xB = b.absoluteBoundingBox ? b.absoluteBoundingBox.x : b.x;
      return xA - xB;
    }

    const textNodes = targetFrame.findAll(node => node.type === "TEXT");
    
    const uniqueFontsToLoad = [];
    for (const t of textNodes) {
      if (t.fontName !== figma.mixed) uniqueFontsToLoad.push(t.fontName);
      else {
        const f = t.getRangeFontName(0, 1);
        if (f && f !== figma.mixed) uniqueFontsToLoad.push(f);
      }
    }
    for (const font of uniqueFontsToLoad) {
      try { await figma.loadFontAsync(font); } catch(e) {}
    }

    function getFontSize(n) { return n.fontSize === figma.mixed ? (n.getRangeFontSize(0, 1) || 0) : (n.fontSize || 0); }

    textNodes.sort((a,b) => {
      const sA = getFontSize(a), sB = getFontSize(b);
      if (sA !== sB) return sB - sA;
      return sortByCoordinates(a, b);
    });

    const titleNode = textNodes.length > 0 ? textNodes.shift() : null;
    const subtitleNode = textNodes.length > 0 ? textNodes.shift() : null;

    if (titleNode) { try { titleNode.name = "#Title"; } catch(e){} }
    if (subtitleNode) { try { subtitleNode.name = "#SubTitle"; } catch(e){} }

    textNodes.sort(sortByCoordinates);
    textNodes.forEach((n, i) => { try { n.name = `#Text_${i+1}`; } catch(e){} });

    const imageNodes = targetFrame.findAll(n => {
      if ('fills' in n && Array.isArray(n.fills)) return n.fills.some(f => f.type === "IMAGE");
      return false;
    });
    imageNodes.sort((a,b) => {
      const aa = a.width*a.height, ab = b.width*b.height;
      if (aa !== ab) return ab - aa;
      return sortByCoordinates(a, b);
    });
    const mainImg = imageNodes.shift();
    if (mainImg) { try { mainImg.name = "@Main_Image"; } catch(e){} }
    imageNodes.sort(sortByCoordinates);
    imageNodes.forEach((n, i) => { try { n.name = `@Image_${i+1}`; } catch(e){} });

    const allFrames = targetFrame.findAll(n => n.type === "FRAME");
    const layoutNodes = [];
    allFrames.forEach(frame => {
      if (frame.children && frame.children.length > 0) {
        if (frame.layoutMode === "NONE") {
          try {
            frame.layoutMode = "VERTICAL";
            let spacing = 0;
            if (frame.children.length >= 2) {
              const sortedKids = [...frame.children].sort((a, b) => a.y - b.y);
              const gaps = [];
              for (let i = 1; i < sortedKids.length; i++) {
                gaps.push(sortedKids[i].y - (sortedKids[i - 1].y + sortedKids[i - 1].height));
              }
              spacing = Math.max(0, Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length));
            }
            frame.itemSpacing = spacing;
            layoutNodes.push(frame);
          } catch(e) {}
        } else {
          layoutNodes.push(frame);
        }
      }
    });

    layoutNodes.sort(sortByCoordinates);
    layoutNodes.forEach((n, i) => { try { n.name = `Layout_${i+1}`; } catch(e){} });
    
    for (const layout of layoutNodes) {
      try {
        if (layout.layoutMode === "VERTICAL") layout.primaryAxisSizingMode = "AUTO";
        else if (layout.layoutMode === "HORIZONTAL") layout.counterAxisSizingMode = "AUTO";
      } catch(e) {}
    }

    const allProcessedTexts = [titleNode, subtitleNode, ...textNodes].filter(n => n !== null);
    for (const t of allProcessedTexts) {
      try {
        if (t.parent && t.parent.layoutMode !== "NONE") t.layoutAlign = "STRETCH";
        t.textAutoResize = "HEIGHT";
      } catch(e){}
    }
}


async function openUI(targetFrame) {
    function highlightNode(node) {
      try {
        const oldStrokes = [...node.strokes];
        const oldWeight = node.strokeWeight;
        node.strokes = [{type: 'SOLID', color: {r:0.09, g:0.62, b:0.98}}]; 
        node.strokeWeight = Math.max(3, oldWeight * 2);
        setTimeout(() => {
          try {
            node.strokes = oldStrokes;
            node.strokeWeight = oldWeight;
          } catch(e){}
        }, 800);
      } catch(e){}
    }

    // 부모를 거슬러 올라가며 전체 틀이 찌그러지지 않도록 레이아웃 높이/넘침 방어를 강제로 재계산합니다.
    function applyRecursiveLayoutGuard(startNode) {
      let current = startNode;
      while (current && current.type !== "PAGE") {
        if (current.type === "FRAME" && current.layoutMode !== "NONE") {
           try {
              if (current.layoutMode === "VERTICAL") {
                 current.primaryAxisSizingMode = "AUTO"; // 세로 높이 Hug contents 보장
                 current.clipsContent = true; // 넘침 방지
              } else if (current.layoutMode === "HORIZONTAL") {
                 current.counterAxisSizingMode = "AUTO"; // 세로 높이 교차축 Hug 보장
                 current.clipsContent = true;
              }
           } catch(e){}
        }
        if (current === targetFrame) break; // 플러그인 실행 루트 캔버스 범위까지만
        current = current.parent;
      }
    }
    
    function applyLayoutGuard(node) {
      try {
        if (node.type === "TEXT") {
           node.textAutoResize = "HEIGHT";
           // 자기가 삐져나가지 않도록 STRETCH 허용
           if (node.parent && node.parent.layoutMode === "VERTICAL") {
              node.layoutAlign = "STRETCH";
           }
        }
        if (node.parent) applyRecursiveLayoutGuard(node.parent);
      } catch(e){}
    }

    function sortByCoordinates(a, b) {
      const yA = a.absoluteBoundingBox ? a.absoluteBoundingBox.y : a.y;
      const yB = b.absoluteBoundingBox ? b.absoluteBoundingBox.y : b.y;
      if (Math.abs(yA - yB) > 10) return yA - yB;
      const xA = a.absoluteBoundingBox ? a.absoluteBoundingBox.x : a.x;
      const xB = b.absoluteBoundingBox ? b.absoluteBoundingBox.x : b.x;
      return xA - xB;
    }

    async function getGroupedFields() {
      const targetItems = targetFrame.findAll(n => 
        n.name.startsWith("#") || n.name.startsWith("@") || n.name === "#Title"
      );
      targetItems.sort(sortByCoordinates);

      const fieldGroupsMap = {};
      
      for (const t of targetItems) {
        let p = t.parent;
        let groupName = "기본 템플릿 컴포넌트";
        let groupId = targetFrame.id; 
        
        while (p && p !== targetFrame.parent) {
          if (p.name.startsWith("Layout_")) {
            groupName = p.name;
            groupId = p.id;
            break;
          }
          p = p.parent;
        }
        
        const parentNode = figma.getNodeById(groupId);
        let layoutDir = "";
        let isVisible = parentNode ? parentNode.visible : true;
        
        if (parentNode && parentNode.layoutMode) {
           if (parentNode.layoutMode === "VERTICAL") layoutDir = " [세로 정렬]";
           else if (parentNode.layoutMode === "HORIZONTAL") layoutDir = " [가로 정렬]";
        }
        
        if (!fieldGroupsMap[groupId]) {
          fieldGroupsMap[groupId] = { 
            groupId, 
            groupName: groupName + layoutDir, 
            visible: isVisible,
            fields: [] 
          };
        }
        
        if (t.type === "TEXT") {
          let semanticLabel = t.characters.substring(0, 16).replace(/\n/g, ' ');
          if (t.characters.length > 16) semanticLabel += "...";
          if (t.name === "#Title") semanticLabel = `👑 ` + semanticLabel;
          else if (t.name === "#SubTitle") semanticLabel = `🔹 ` + semanticLabel;

          let fontSz = t.fontSize;
          if (fontSz === figma.mixed) fontSz = t.getRangeFontSize(0, 1) || 14;
          
          let fontWeight = "Regular";
          if (t.fontName !== figma.mixed) fontWeight = t.fontName.style;
          else {
             const fn = t.getRangeFontName(0, 1);
             if (fn) fontWeight = fn.style;
          }
          
          let fillHex = "#000000";
          if (t.fills !== figma.mixed && t.fills.length > 0 && t.fills[0].type === "SOLID") {
             const r = Math.round(t.fills[0].color.r * 255);
             const g = Math.round(t.fills[0].color.g * 255);
             const b = Math.round(t.fills[0].color.b * 255);
             fillHex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).padStart(6, '0');
          }

          fieldGroupsMap[groupId].fields.push({
            id: t.id,
            name: t.name,
            type: "TEXT",
            semanticLabel: semanticLabel || "(비어있음)",
            characters: t.characters,
            fontSize: Math.round(Number(fontSz) * 10) / 10,
            fontWeight: fontWeight,
            fillColor: fillHex
          });
        } else {
          let thumbBase64 = null;
          try {
             const bytes = await t.exportAsync({ format: 'PNG', constraint: { type: 'WIDTH', value: 70 } });
             thumbBase64 = figma.base64Encode(bytes);
          } catch(e) {}
          
          fieldGroupsMap[groupId].fields.push({
            id: t.id,
            name: t.name,
            type: "IMAGE",
            semanticLabel: `🖼️ [이미지 변경] ` + t.name,
            thumbnail: thumbBase64 ? 'data:image/png;base64,' + thumbBase64 : null
          });
        }
      }
      return Object.values(fieldGroupsMap);
    }

    figma.showUI(__html__, { width: 380, height: 680, themeColors: true });
    figma.ui.postMessage({ type: 'init-fields', groups: await getGroupedFields() });

    figma.ui.onmessage = async (msg) => {
      
      if (msg.type === 'focus-node') {
        const node = figma.getNodeById(msg.id);
        if (node && node.visible) {
          figma.currentPage.selection = [node];
          figma.viewport.scrollAndZoomIntoView([node]);
          highlightNode(node);
        }
      }

      if (msg.type === 'clone-group') {
        const targetNode = figma.getNodeById(msg.id);
        if (targetNode && targetNode.type === "FRAME" && targetNode.parent) {
          try {
            const parent = targetNode.parent;
            
            // 💡 세로로 나열되도록 속성 강제 변환 병합
            if (parent.layoutMode === "HORIZONTAL") {
               parent.layoutMode = "VERTICAL";
            }
            
            const clone = targetNode.clone();
            const index = parent.children.indexOf(targetNode);
            parent.insertChild(index + 1, clone);
            clone.visible = true; 
            
            // 찌그러짐 방지를 위해 재귀적으로 상단 컨테이너들의 Hug Properties 강제복원
            applyRecursiveLayoutGuard(parent);

            figma.notify(`➕ 항목이 성공적으로 복제/삽입 되었습니다.`);
            figma.ui.postMessage({ type: 'init-fields', groups: await getGroupedFields() });
            
            figma.currentPage.selection = [clone];
            figma.viewport.scrollAndZoomIntoView([clone]);
          } catch(e) {
            figma.notify("오류가 발생했습니다 (인스턴스 등 제한된 템플릿에서는 복제 불가).", {error:true});
          }
        }
      }

      if (msg.type === 'soft-delete-group') {
        const targetNode = figma.getNodeById(msg.id);
        if (targetNode && targetNode.type === "FRAME") {
           targetNode.visible = false;
           applyRecursiveLayoutGuard(targetNode.parent);
           figma.notify(`👁️ 항목이 삭제(숨김) 처리되어 휴지통으로 이동했습니다.`);
           figma.ui.postMessage({ type: 'init-fields', groups: await getGroupedFields() });
        }
      }

      if (msg.type === 'restore-group') {
        const targetNode = figma.getNodeById(msg.id);
        if (targetNode && targetNode.type === "FRAME") {
           targetNode.visible = true;
           applyRecursiveLayoutGuard(targetNode.parent);
           figma.notify(`🚀 항목이 성공적으로 복구되었습니다.`);
           figma.ui.postMessage({ type: 'init-fields', groups: await getGroupedFields() });
           figma.currentPage.selection = [targetNode];
           figma.viewport.scrollAndZoomIntoView([targetNode]);
        }
      }

      if (msg.type === 'hard-delete-group') {
        const targetNode = figma.getNodeById(msg.id);
        if (targetNode && targetNode.type === "FRAME") {
          try {
            const tempParent = targetNode.parent;
            targetNode.remove();
            applyRecursiveLayoutGuard(tempParent);
            figma.notify(`🗑️ 해당 원본이 완전히 파기(영구 삭제)되었습니다.`);
            figma.ui.postMessage({ type: 'init-fields', groups: await getGroupedFields() });
          } catch(e) {
            figma.notify("메인 컴포넌트나 읽기 전용 구조에서는 파기할 수 없습니다.", {error:true});
          }
        }
      }

      if (msg.type === 'update-font-size') {
        const node = figma.getNodeById(msg.id);
        if (node && node.type === "TEXT") {
          try {
            if (node.hasMissingFont) {
               figma.notify("폰트 누락 제약", {error: true});
            } else {
               const len = node.characters.length;
               if (len > 0) {
                 const fontsToLoad = node.getRangeAllFontNames(0, len);
                 for (const f of fontsToLoad) { await figma.loadFontAsync(f); }
                 node.setRangeFontSize(0, len, msg.size);
               } else {
                 node.fontSize = msg.size;
               }
               applyLayoutGuard(node);
               highlightNode(node);
            }
          } catch(e) {}
        }
      }
      
      if (msg.type === 'update-font-style') {
        const node = figma.getNodeById(msg.id);
        if (node && node.type === "TEXT") {
          try {
            const font = node.fontName === figma.mixed ? node.getRangeFontName(0, 1) : node.fontName;
            if (font && !node.hasMissingFont) {
               const newFont = { family: font.family, style: msg.weight };
               await figma.loadFontAsync(newFont);
               const len = node.characters.length;
               if (len > 0) node.setRangeFontName(0, len, newFont);
               else node.fontName = newFont;
               applyLayoutGuard(node);
               highlightNode(node);
            }
          } catch(e) {
             figma.notify("해당 서체에서는 지원하지 않는 굵기입니다.", {error: true});
          }
        }
      }

      if (msg.type === 'update-color') {
        const node = figma.getNodeById(msg.id);
        if (node && node.type === "TEXT") {
          try {
            const hex = msg.color;
            const r = parseInt(hex.substr(1, 2), 16) / 255;
            const g = parseInt(hex.substr(3, 2), 16) / 255;
            const b = parseInt(hex.substr(5, 2), 16) / 255;
            const len = node.characters.length;
            if (len > 0) node.setRangeFills(0, len, [{type: 'SOLID', color: {r, g, b}}]);
            else node.fills = [{type: 'SOLID', color: {r, g, b}}];
            highlightNode(node);
          } catch(e) {}
        }
      }

      if (msg.type === 'update-image') {
        const node = figma.getNodeById(msg.id);
        if (node && 'fills' in node) {
          try {
            const newImage = figma.createImage(msg.bytes);
            const newFills = [...node.fills];
            let replaced = false;
            for (let i = 0; i < newFills.length; i++) {
               if (newFills[i].type === "IMAGE") {
                 newFills[i] = { type: "IMAGE", scaleMode: "FILL", imageHash: newImage.hash };
                 replaced = true; break;
               }
            }
            if (!replaced) newFills.push({ type: "IMAGE", scaleMode: "FILL", imageHash: newImage.hash });
            node.fills = newFills;
            highlightNode(node);
            
            figma.ui.postMessage({ type: 'init-fields', groups: await getGroupedFields() });
          } catch(e) {}
        }
      }

      if (msg.type === 'update-texts') {
        let successCount = 0;
        for (const update of msg.updates) {
          const node = figma.getNodeById(update.id);
          if (node && node.type === "TEXT" && node.characters !== update.characters) {
            try {
              if (node.hasMissingFont) continue; 
              
              const len = node.characters.length;
              if (len > 0) {
                 const styledSegments = node.getStyledTextSegments(['fontName', 'fontSize', 'fontWeight', 'fills', 'letterSpacing', 'lineHeight']);
                 const fontsToLoad = node.getRangeAllFontNames(0, len);
                 for (const f of fontsToLoad) { await figma.loadFontAsync(f); }
                 
                 node.characters = update.characters; 
                 
                 const newLen = update.characters.length;
                 let currPos = 0;
                 for (const seg of styledSegments) {
                   if (currPos >= newLen) break;
                   const segLen = seg.end - seg.start;
                   const newEnd = Math.min(newLen, currPos + segLen);
                   
                   if (seg.fontName) { await figma.loadFontAsync(seg.fontName); node.setRangeFontName(currPos, newEnd, seg.fontName); }
                   if (seg.fills) node.setRangeFills(currPos, newEnd, seg.fills);
                   if (seg.fontSize) node.setRangeFontSize(currPos, newEnd, seg.fontSize);
                   if (seg.letterSpacing) node.setRangeLetterSpacing(currPos, newEnd, seg.letterSpacing);
                   if (seg.lineHeight) node.setRangeLineHeight(currPos, newEnd, seg.lineHeight);
                   
                   currPos = newEnd;
                 }
              } else {
                 node.characters = update.characters;
              }
              
              applyLayoutGuard(node);
              highlightNode(node);
              successCount++;
            } catch(e) {}
          }
        }
        figma.notify(`✨ 텍스트 ${successCount}곳이 퍼펙트 매칭 완료되었습니다!`);
      }
      
      if (msg.type === 'close') {
        figma.closePlugin();
      }
    };
}

main();
