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

    let textRenamedCount = 0;
    let imageRenamedCount = 0;
    let layoutRenamedCount = 0;
    let autoLayoutConvertedCount = 0;

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

    // 나중에 textAutoResize 설정을 위해 폰트 강제 선로드 (필수)
    for (const font of uniqueFontsToLoad) {
      try {
        await figma.loadFontAsync(font);
      } catch(e) {
        console.warn("폰트 로드 실패:", font, e);
      }
    }

    // --------------------------------------------------------
    // 2. 텍스트 레이어 네이밍 로직
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

    if (titleNode) { try { titleNode.name = "#Title"; textRenamedCount++; } catch(e) {} }
    if (subtitleNode) { try { subtitleNode.name = "#SubTitle"; textRenamedCount++; } catch(e) {} }

    textNodes.sort(sortByCoordinates);
    textNodes.forEach((node, index) => {
      try { node.name = `#Text_${index + 1}`; textRenamedCount++; } catch (e) {}
    });

    // --------------------------------------------------------
    // 3. 이미지 레이어 네이밍 보강
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
    if (mainImage) { try { mainImage.name = "@Main_Image"; imageRenamedCount++; } catch(e) {} }

    imageNodes.sort(sortByCoordinates);
    imageNodes.forEach((node, index) => {
      try { node.name = `@Image_${index + 1}`; imageRenamedCount++; } catch(e) {}
    });

    // --------------------------------------------------------
    // 4. 상위 프레임 오토레이아웃 강제 전환 & 네이밍 (NEW 로직)
    // --------------------------------------------------------
    const allFrames = targetFrame.findAll(node => node.type === "FRAME" && isEditableNode(node));
    const layoutNodes = [];

    // 텍스트/이미지를 자식으로 가지는 프레임 등을 오토레이아웃으로 전격 변환!
    allFrames.forEach(frame => {
      if (frame.children && frame.children.length > 0) {
        if (frame.layoutMode === "NONE") {
          try {
            // 구조 강제화 (세로 오토레이아웃)
            frame.layoutMode = "VERTICAL";
            
            // 물리적 간격을 계산하여 itemSpacing에 자연스럽게 반영
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
            
            autoLayoutConvertedCount++;
            layoutNodes.push(frame); // 성공하면 layout 배열에 추가
          } catch(e) {
            console.warn("오토레이아웃 전환 실패:", e);
          }
        } else {
          // 이미 오토레이아웃인 아이켓도 배열에 병합
          layoutNodes.push(frame);
        }
      }
    });

    layoutNodes.sort(sortByCoordinates);
    layoutNodes.forEach((node, index) => {
      try {
        node.name = `Layout_${index + 1}`; 
        layoutRenamedCount++;
      } catch(e) {}
    });

    // --------------------------------------------------------
    // 5. 가변 크기 속성 강제 (Resizing Rules)
    // --------------------------------------------------------
    // 5-1. 모든 Layout_XX 의 세로 높이는 Hug contents로 설정
    for (const layout of layoutNodes) {
      try {
        if (layout.layoutMode === "VERTICAL") {
          layout.primaryAxisSizingMode = "AUTO"; // 세로축 Hug
        } else if (layout.layoutMode === "HORIZONTAL") {
          layout.counterAxisSizingMode = "AUTO"; // 피그마 규격상 가로배열에서는 교차축(세로)이 Hug
        }
      } catch(e) {
        console.warn("Layout resize rule 적용 실패:", e);
      }
    }

    // 5-2. 결합된 전체 텍스트 노드 처리 (가로 꽉 채움, 세로 텍스트 폭에 맞춤)
    const allProcessedTextNodes = [titleNode, subtitleNode, ...textNodes].filter(n => n !== null);

    for (const text of allProcessedTextNodes) {
      try {
        // 너비: Fill container (가로/세로 방향 상관없이 STRETCH)
        if (text.parent && text.parent.layoutMode !== "NONE") {
          text.layoutAlign = "STRETCH"; 
        }
        // 높이: Hug contents (수직 방향 글자 수에 따라 늘어남) - *반드시 사전에 폰트가 로드되어야 에러가 나지 않음*
        text.textAutoResize = "HEIGHT";
      } catch(e) {
        console.warn("Text resize rule 적용 실패:", e);
      }
    }

    // --------------------------------------------------------
    // 6. 결과 알림
    // --------------------------------------------------------
    figma.notify(`✅ 총 ${autoLayoutConvertedCount}개의 컨테이너를 오토레이아웃으로 전환했습니다. 이제 텍스트 길이에 상관없이 디자인이 깨지지 않습니다. 2단계(UI 개발)로 진행하셔도 좋습니다.`, { timeout: 5000 });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    figma.notify("오류가 발생했습니다: " + errorMsg, { error: true });
    console.error("Plugin crashed:", err);
  } finally {
    figma.closePlugin();
  }
}

// 스크립트가 Async-Await을 쓰기 위해 트리거 함수로 실행
main();
