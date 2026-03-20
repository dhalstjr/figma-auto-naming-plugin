async function main() {
  try {
    const selection = figma.currentPage.selection;
    
    // 1. 선택 유효성 검사
    if (
      selection.length === 0 || 
      !(selection[0].type === "FRAME" || selection[0].type === "COMPONENT")
    ) {
      figma.notify("기준이 되는 프레임이나 컴포넌트를 선택해 주세요.", { error: true });
      figma.closePlugin();
      return;
    }

    const targetFrame = selection[0];

    function isEditableNode(node) {
      let current = node.parent;
      while (current && current !== targetFrame.parent) {
        if (current.type === "INSTANCE") return false;
        current = current.parent;
      }
      return true;
    }

    function sortByCoordinates(a, b) {
      const yA = a.absoluteBoundingBox ? a.absoluteBoundingBox.y : a.y;
      const yB = b.absoluteBoundingBox ? b.absoluteBoundingBox.y : b.y;
      if (Math.abs(yA - yB) > 10) return yA - yB;
      const xA = a.absoluteBoundingBox ? a.absoluteBoundingBox.x : a.x;
      const xB = b.absoluteBoundingBox ? b.absoluteBoundingBox.x : b.x;
      return xA - xB;
    }

    // --------------------------------------------------------
    // [NEW] 폰트 로딩 사전 점검 (Pre-flight Check)
    // --------------------------------------------------------
    const textNodes = targetFrame.findAll(node => node.type === "TEXT" && isEditableNode(node));
    const fontsSet = new Set();
    const uniqueFontsToLoad = [];
    
    for (const t of textNodes) {
      if (t.fontName !== figma.mixed) {
        const fontStr = `${t.fontName.family} ${t.fontName.style}`;
        if (!fontsSet.has(fontStr)) {
          fontsSet.add(fontStr);
          uniqueFontsToLoad.push(t.fontName);
        }
      } else {
        const f = t.getRangeFontName(0, 1);
        if (f && f !== figma.mixed) {
          const fontStr = `${f.family} ${f.style}`;
          if (!fontsSet.has(fontStr)) {
            fontsSet.add(fontStr);
            uniqueFontsToLoad.push(f);
          }
        }
      }
    }
    
    console.log("=== 템플릿 폰트 사용 리스트 ===");
    console.log(Array.from(fontsSet));

    for (const font of uniqueFontsToLoad) {
      try {
        await figma.loadFontAsync(font);
      } catch(e) {
        console.warn("폰트 로드 실패:", font, e);
      }
    }

    // --------------------------------------------------------
    // 2. 텍스트 레이어 네이밍 (기존 기능 수행)
    // --------------------------------------------------------
    function getFontSize(textNode) {
      if (textNode.fontSize === figma.mixed) return textNode.getRangeFontSize(0, 1) || 0;
      return textNode.fontSize || 0;
    }

    textNodes.sort((a, b) => {
      const sizeA = getFontSize(a);
      const sizeB = getFontSize(b);
      if (sizeA !== sizeB) return sizeB - sizeA;
      return sortByCoordinates(a, b);
    });

    const titleNode = textNodes.length > 0 ? textNodes.shift() : null;
    const subtitleNode = textNodes.length > 0 ? textNodes.shift() : null;

    if (titleNode) { try { titleNode.name = "#Title"; } catch(e) {} }
    if (subtitleNode) { try { subtitleNode.name = "#SubTitle"; } catch(e) {} }

    textNodes.sort(sortByCoordinates);
    textNodes.forEach((node, index) => {
      try { node.name = `#Text_${index + 1}`; } catch (e) {}
    });

    // --------------------------------------------------------
    // 3. 이미지 레이어 정리
    // --------------------------------------------------------
    const imageNodes = targetFrame.findAll(node => {
      if (!isEditableNode(node)) return false;
      if ('fills' in node && Array.isArray(node.fills)) {
        return node.fills.some(fill => fill.type === "IMAGE");
      }
      return false;
    });

    imageNodes.sort((a, b) => {
      const areaA = a.width * a.height;
      const areaB = b.width * b.height;
      if (areaA !== areaB) return areaB - areaA;
      return sortByCoordinates(a, b);
    });

    const mainImage = imageNodes.length > 0 ? imageNodes.shift() : null;
    if (mainImage) { try { mainImage.name = "@Main_Image"; } catch(e) {} }

    imageNodes.sort(sortByCoordinates);
    imageNodes.forEach((node, index) => {
      try { node.name = `@Image_${index + 1}`; } catch(e) {}
    });

    // --------------------------------------------------------
    // 4. 오토레이아웃 강제 전환
    // --------------------------------------------------------
    const allFrames = targetFrame.findAll(node => node.type === "FRAME" && isEditableNode(node));
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
                const prev = sortedKids[i - 1];
                const curr = sortedKids[i];
                gaps.push(curr.y - (prev.y + prev.height));
              }
              const avgGap = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
              spacing = Math.max(0, Math.round(avgGap));
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
    layoutNodes.forEach((node, index) => {
      try { node.name = `Layout_${index + 1}`; } catch(e) {}
    });

    for (const layout of layoutNodes) {
      try {
        if (layout.layoutMode === "VERTICAL") {
          layout.primaryAxisSizingMode = "AUTO"; 
        } else if (layout.layoutMode === "HORIZONTAL") {
          layout.counterAxisSizingMode = "AUTO"; 
        }
      } catch(e) {}
    }

    const allProcessedTextNodes = [titleNode, subtitleNode, ...textNodes].filter(n => n !== null);

    for (const text of allProcessedTextNodes) {
      try {
        if (text.parent && text.parent.layoutMode !== "NONE") {
          text.layoutAlign = "STRETCH"; 
        }
        text.textAutoResize = "HEIGHT";
      } catch(e) {}
    }


    // --------------------------------------------------------
    // 6. 플러그인 UI (HTML) 브릿지 호출 및 통신 로직
    // --------------------------------------------------------
    figma.notify(`✅ 자동 세팅 완료! 표시된 폼에 새로운 디자인 내용을 입력하세요.`);

    // UI에 전달할 #Text_ 데이터 추출
    const finalTexts = targetFrame.findAll(node => 
      node.type === "TEXT" && 
      isEditableNode(node) && 
      (node.name.startsWith("#") || node.name === "#Title" || node.name === "#SubTitle")
    );
    finalTexts.sort(sortByCoordinates);

    const textFieldsForUI = [];
    for (const t of finalTexts) {
      textFieldsForUI.push({
        id: t.id,
        name: t.name,
        characters: t.characters
      });
    }

    // 🌟 HTML UI 랜더링 (여기서 figma.closePlugin을 하면 안 됨)
    figma.showUI(__html__, { width: 340, height: 600, themeColors: true });
    
    // UI 로드가 약간 걸리므로 바로 쏴주면 대기중이던 HTML이 수령
    figma.ui.postMessage({ type: 'init-fields', fields: textFieldsForUI });

    // HTML 버튼 클릭 메시지 수신 (양방향 연결)
    figma.ui.onmessage = async (msg) => {
      if (msg.type === 'update-texts') {
        let successCount = 0;
        for (const update of msg.updates) {
          const node = figma.getNodeById(update.id);
          if (node && node.type === "TEXT") {
            try {
              // 안전한 값 대입을 위한 마지막 방어선 로딩
              if (node.fontName !== figma.mixed) {
                await figma.loadFontAsync(node.fontName);
              } else {
                const f = node.getRangeFontName(0, 1);
                if (f && f !== figma.mixed) await figma.loadFontAsync(f);
              }
              // 사용자가 입력 폼에서 쓴 글자를 피그마 레이어에 덮어씌움
              node.characters = update.characters;
              successCount++;
            } catch(e) {
              console.warn("폰트 로드 또는 대입 실패:", e);
            }
          }
        }
        figma.notify(`✨ ${successCount}개의 디자인 텍스트가 즉시 교체되었습니다!`);
      }
      
      if (msg.type === 'close') {
        figma.closePlugin();
      }
    };

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    figma.notify("오류가 발생했습니다: " + errorMsg, { error: true });
    console.error("Plugin crashed:", err);
    // 예외 오류 발생 시에만 플러그인 종료
    figma.closePlugin(); 
  }
}

main();
