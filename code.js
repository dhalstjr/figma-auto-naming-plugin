async function main() {
  try {
    const selection = figma.currentPage.selection;
    
    // 1. 선택 유효성 검사
    if (
      selection.length === 0 || 
      !(selection[0].type === "FRAME" || selection[0].type === "COMPONENT" || selection[0].type === "INSTANCE")
    ) {
      figma.notify("기준이 되는 프레임이나 컴포넌트를 선택해 주세요.", { error: true });
      figma.closePlugin();
      return;
    }

    const targetFrame = selection[0];

    // 스캔: 이 템플릿이 이미 1단계 진행이 되었는지 판단
    const isFormatted = targetFrame.findOne(n => n.name.startsWith("#Text") || n.name.startsWith("@Image") || n.name.startsWith("Layout_"));
    
    if (!isFormatted) {
      figma.notify("초기 템플릿 1단계 자동 세팅을 진행합니다...");
      await runFormatting(targetFrame);
    }
    
    // UI 오픈 (통합)
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
          layoutNodes.push(frame); // 이미 오토레이아웃
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


function openUI(targetFrame) {
    function sortByCoordinates(a, b) {
      const yA = a.absoluteBoundingBox ? a.absoluteBoundingBox.y : a.y;
      const yB = b.absoluteBoundingBox ? b.absoluteBoundingBox.y : b.y;
      if (Math.abs(yA - yB) > 10) return yA - yB;
      const xA = a.absoluteBoundingBox ? a.absoluteBoundingBox.x : a.x;
      const xB = b.absoluteBoundingBox ? b.absoluteBoundingBox.x : b.x;
      return xA - xB;
    }

    // 데이터 패치: Get updated groups
    function getGroupedFields() {
      const currentTexts = targetFrame.findAll(n => n.type === "TEXT");
      currentTexts.sort(sortByCoordinates);

      const fieldGroupsMap = {};
      for (const t of currentTexts) {
        let p = t.parent;
        let groupName = "텍스트 기본 요소";
        let groupId = targetFrame.id; 
        
        while (p && p !== targetFrame.parent) {
          if (p.name.startsWith("Layout_")) {
            groupName = p.name;
            groupId = p.id;
            break;
          }
          p = p.parent;
        }
        
        if (!fieldGroupsMap[groupId]) {
          fieldGroupsMap[groupId] = { groupId, groupName, fields: [] };
        }
        
        // Smart Mapping UX 및 폰트 사이즈
        let semanticLabel = t.characters.substring(0, 16).replace(/\n/g, ' ');
        if (t.characters.length > 16) semanticLabel += "...";
        if (t.name === "#Title") semanticLabel = `👑 ` + semanticLabel;
        else if (t.name === "#SubTitle") semanticLabel = `🔹 ` + semanticLabel;

        let fontSize = t.fontSize;
        if (fontSize === figma.mixed) {
          fontSize = t.getRangeFontSize(0, 1) || 14;
        }

        fieldGroupsMap[groupId].fields.push({
          id: t.id,
          name: t.name,
          semanticLabel: semanticLabel || "(비어있음)",
          characters: t.characters,
          fontSize: Math.round(Number(fontSize) * 10) / 10
        });
      }
      return Object.values(fieldGroupsMap);
    }

    figma.showUI(__html__, { width: 360, height: 640, themeColors: true });
    figma.ui.postMessage({ type: 'init-fields', groups: getGroupedFields() });

    figma.ui.onmessage = async (msg) => {
      
      // 1. 캔버스 자동 이동 (Focus Mode)
      if (msg.type === 'focus-node') {
        const node = figma.getNodeById(msg.id);
        if (node) {
          figma.currentPage.selection = [node];
          figma.viewport.scrollAndZoomIntoView([node]);
          
          try {
             // 포커스 시 강조 표시 (임시 스트로크 적용)
             const oldStrokes = [...node.strokes];
             const oldWeight = node.strokeWeight;
             node.strokes = [{type: 'SOLID', color: {r:0.09, g:0.62, b:0.98}}]; // Figma Blue
             node.strokeWeight = Math.max(3, oldWeight * 2);
             setTimeout(() => {
                try {
                  node.strokes = oldStrokes;
                  node.strokeWeight = oldWeight;
                } catch(e){}
             }, 800);
          } catch(e){}
        }
      }

      // 2. Repeater (행 복제)
      if (msg.type === 'clone-group') {
        const nodeToClone = figma.getNodeById(msg.id);
        if (nodeToClone && nodeToClone.type === "FRAME" && nodeToClone.parent) {
          try {
            const clone = nodeToClone.clone();
            const index = nodeToClone.parent.children.indexOf(nodeToClone);
            nodeToClone.parent.insertChild(index + 1, clone);
            figma.notify(`➕ 추가되었습니다: 행이 복제 완료!`);
            figma.ui.postMessage({ type: 'init-fields', groups: getGroupedFields() });
          } catch(e) {
            figma.notify("인스턴스 등 제한된 영역 구조에서는 행을 통째로 복제할 수 없습니다.", {error:true});
          }
        }
      }

      // 3. Repeater (행 삭제)
      if (msg.type === 'delete-group') {
        const nodeToDelete = figma.getNodeById(msg.id);
        if (nodeToDelete && nodeToDelete.type === "FRAME") {
          try {
            const tempName = nodeToDelete.name;
            nodeToDelete.remove();
            figma.notify(`🗑️ [${tempName}] 행이 안전하게 삭제되었습니다.`);
            figma.ui.postMessage({ type: 'init-fields', groups: getGroupedFields() });
          } catch(e) {
            figma.notify("인스턴스 메인 컴포넌트 내부 등에서는 강제로 삭제할 수 없습니다.", {error:true});
          }
        }
      }

      // 4. 실시간 폰트 사이즈 업데이트
      if (msg.type === 'update-font-size') {
        const node = figma.getNodeById(msg.id);
        if (node && node.type === "TEXT") {
          try {
            if (node.hasMissingFont) {
               figma.notify("폰트 누락 오류로 인해 글자 크기를 강제 적용할 수 없습니다.", {error: true});
            } else {
               const len = node.characters.length;
               if (len > 0) {
                 // 폰트 강제 로드 (에러 방어)
                 const fontsToLoad = node.getRangeAllFontNames(0, len);
                 for (const f of fontsToLoad) { await figma.loadFontAsync(f); }
                 
                 // 전체 문장에 새 크기 지정
                 node.setRangeFontSize(0, len, msg.size);
               } else {
                 node.fontSize = msg.size;
               }
            }
          } catch(e) {
            console.warn("폰트 크기 변경 실패:", e);
          }
        }
      }

      // 5. 텍스트 일괄 교체 & 기존 인라인 스타일 보존
      if (msg.type === 'update-texts') {
        let successCount = 0;
        for (const update of msg.updates) {
          const node = figma.getNodeById(update.id);
          if (node && node.type === "TEXT" && node.characters !== update.characters) {
            try {
              if (node.hasMissingFont) {
                 console.warn("단락 폰트 누락 오류 방지:", node.name);
                 continue; 
              }

              const len = node.characters.length;
              if (len > 0) {
                 const styledSegments = node.getStyledTextSegments(['fontName', 'fontSize', 'fontWeight', 'fills', 'letterSpacing', 'lineHeight']);
                 
                 const fontsToLoad = node.getRangeAllFontNames(0, len);
                 for (const f of fontsToLoad) { await figma.loadFontAsync(f); }
                 
                 // 교체
                 node.characters = update.characters; 
                 
                 // 캐싱된 혼합 스타일들을 새로 들어간 글자 위치에 스케일링하여 덮어씌움
                 const newLen = update.characters.length;
                 let currPos = 0;
                 for (const seg of styledSegments) {
                   if (currPos >= newLen) break;
                   const segLen = seg.end - seg.start;
                   const newEnd = Math.min(newLen, currPos + segLen);
                   
                   if (seg.fontName) {
                     await figma.loadFontAsync(seg.fontName);
                     node.setRangeFontName(currPos, newEnd, seg.fontName);
                   }
                   if (seg.fills) node.setRangeFills(currPos, newEnd, seg.fills);
                   if (seg.fontSize) node.setRangeFontSize(currPos, newEnd, seg.fontSize);
                   if (seg.letterSpacing) node.setRangeLetterSpacing(currPos, newEnd, seg.letterSpacing);
                   if (seg.lineHeight) node.setRangeLineHeight(currPos, newEnd, seg.lineHeight);
                   
                   currPos = newEnd;
                 }
              } else {
                 node.characters = update.characters;
              }
              
              successCount++;
            } catch(e) {
              console.warn("텍스트 교체 실패:", e);
            }
          }
        }
        figma.notify(`✨ 디자인 텍스트 ${successCount}곳이 퍼펙트 매칭 완료되었습니다!`);
      }
      
      if (msg.type === 'close') {
        figma.closePlugin();
      }
    };
}

// 부트스트랩 호출
main();
