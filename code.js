function main() {
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

    // 읽기 전용 인스턴스 레이어 스킵
    function isEditableNode(node) {
      let current = node.parent;
      while (current && current !== targetFrame.parent) {
        if (current.type === "INSTANCE") return false;
        current = current.parent;
      }
      return true;
    }

    // 좌표 기반 정렬 (Y기준 정렬, 10px 이내는 X기준 좌에서 우)
    function sortByCoordinates(a, b) {
      const yA = a.absoluteBoundingBox ? a.absoluteBoundingBox.y : a.y;
      const yB = b.absoluteBoundingBox ? b.absoluteBoundingBox.y : b.y;
      
      if (Math.abs(yA - yB) > 10) {
        return yA - yB; // 10px 이상 차이나면 Y좌표가 위인 것이 먼저
      }
      
      // 높이가 10px 이내로 비슷하다면 좌에서 우로 정렬
      const xA = a.absoluteBoundingBox ? a.absoluteBoundingBox.x : a.x;
      const xB = b.absoluteBoundingBox ? b.absoluteBoundingBox.x : b.x;
      return xA - xB;
    }

    let textRenamedCount = 0;
    let imageRenamedCount = 0;
    let layoutRenamedCount = 0;
    let missingLayoutCount = 0;

    // --------------------------------------------------------
    // 2. 텍스트 레이어 네이밍 로직 (폰트 크기 TOP 2 + 좌표 정렬)
    // --------------------------------------------------------
    const textNodes = targetFrame.findAll(node => node.type === "TEXT" && isEditableNode(node));

    function getFontSize(textNode) {
      if (textNode.fontSize === figma.mixed) {
        return textNode.getRangeFontSize(0, 1) || 0;
      }
      return textNode.fontSize || 0;
    }

    // 크기 내우선 정렬 (크기 같으면 좌표순)
    textNodes.sort((a, b) => {
      const sizeA = getFontSize(a);
      const sizeB = getFontSize(b);
      if (sizeA !== sizeB) return sizeB - sizeA;
      return sortByCoordinates(a, b);
    });

    const titleNode = textNodes.length > 0 ? textNodes.shift() : null;
    const subtitleNode = textNodes.length > 0 ? textNodes.shift() : null;

    if (titleNode) {
      try { titleNode.name = "#Title"; textRenamedCount++; } catch(e) {}
    }
    if (subtitleNode) {
      try { subtitleNode.name = "#SubTitle"; textRenamedCount++; } catch(e) {}
    }

    // 나머지 텍스트들은 오직 좌표 기준으로 재정렬 후 번호 부여
    textNodes.sort(sortByCoordinates);
    textNodes.forEach((node, index) => {
      try {
        node.name = `#Text_${index + 1}`;
        textRenamedCount++;
      } catch (e) {
        console.warn("텍스트 네이밍 실패:", e);
      }
    });

    // --------------------------------------------------------
    // 3. 이미지 레이어 네이밍 보강 (면적 TOP 1 + 좌표 정렬)
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
    if (mainImage) {
      try { mainImage.name = "@Main_Image"; imageRenamedCount++; } catch(e) {}
    }

    imageNodes.sort(sortByCoordinates);
    imageNodes.forEach((node, index) => {
      try {
        node.name = `@Image_${index + 1}`; 
        imageRenamedCount++;
      } catch(e) {}
    });

    // --------------------------------------------------------
    // 4. 오토레이아웃 네이밍 및 누락 검증 로직
    // --------------------------------------------------------
    const allFrames = targetFrame.findAll(node => node.type === "FRAME" && isEditableNode(node));
    const layoutNodes = [];

    allFrames.forEach(frame => {
      // 자식 요소가 하나 이상 있는 프레임만 대상으로 함
      if (frame.children && frame.children.length > 0) {
        if (frame.layoutMode === "NONE") {
          // 오토레이아웃이 누락된 일반 프레임!
          try {
            // 태그가 이미 적용되어 있는지 확인하여 중복 방지
            const cleanName = frame.name.replace(/^🚨\[오토레이아웃 필요\]\s*/, "");
            frame.name = `🚨[오토레이아웃 필요] ${cleanName}`;
            missingLayoutCount++;
          } catch(e) {}
        } else {
          // 이상이 없는 오토레이아웃 프레임은 배열에 담아 네이밍 준비
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
    // 5. 작업 완료 알림결과 리포트
    // --------------------------------------------------------
    let summaryText = `✅ 텍스트 ${textRenamedCount}개, 이미지 ${imageRenamedCount}개 네이밍 완료.`;
    
    if (missingLayoutCount > 0) {
      summaryText += ` (⚠️ 오토레이아웃 누락: ${missingLayoutCount}건)`;
      figma.notify(summaryText, { error: true });
    } else {
      figma.notify(summaryText);
    }

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    figma.notify("오류가 발생했습니다: " + errorMsg, { error: true });
    console.error("Plugin crashed:", err);
  } finally {
    figma.closePlugin();
  }
}

main();
