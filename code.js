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

    // 인스턴스(.type === "INSTANCE") 내부에 속한 노드는 이름 변경이 불가능하므로 필터링하는 헬퍼 함수
    function isEditableNode(node) {
      let current = node.parent;
      while (current && current !== targetFrame.parent) {
        if (current.type === "INSTANCE") return false;
        current = current.parent;
      }
      return true;
    }

    // --------------------------------------------------------
    // 2. 텍스트 레이어 네이밍 규칙 적용
    // --------------------------------------------------------
    const textNodes = targetFrame.findAll(node => node.type === "TEXT" && isEditableNode(node));

    function getFontSize(textNode) {
      if (textNode.fontSize === figma.mixed) {
        return textNode.getRangeFontSize(0, 1) || 0;
      }
      return textNode.fontSize || 0;
    }

    textNodes.sort((a, b) => {
      const sizeA = getFontSize(a);
      const sizeB = getFontSize(b);
      if (sizeA !== sizeB) return sizeB - sizeA;
      
      const yA = a.absoluteBoundingBox ? a.absoluteBoundingBox.y : a.y;
      const yB = b.absoluteBoundingBox ? b.absoluteBoundingBox.y : b.y;
      if (Math.abs(yA - yB) > 1) return yA - yB;
      
      const xA = a.absoluteBoundingBox ? a.absoluteBoundingBox.x : a.x;
      const xB = b.absoluteBoundingBox ? b.absoluteBoundingBox.x : b.x;
      return xA - xB;
    });

    textNodes.forEach((node, index) => {
      try {
        if (index === 0) node.name = "#Title";
        else if (index === 1) node.name = "#SubTitle";
        else node.name = `#Text_${index - 1}`;
      } catch (e) {
        console.warn("Failed to rename text node:", e);
      }
    });

    // --------------------------------------------------------
    // 3. 이미지 레이어 네이밍 규칙 적용
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
      
      const yA = a.absoluteBoundingBox ? a.absoluteBoundingBox.y : a.y;
      const yB = b.absoluteBoundingBox ? b.absoluteBoundingBox.y : b.y;
      if (Math.abs(yA - yB) > 1) return yA - yB;
      
      const xA = a.absoluteBoundingBox ? a.absoluteBoundingBox.x : a.x;
      const xB = b.absoluteBoundingBox ? b.absoluteBoundingBox.x : b.x;
      return xA - xB;
    });

    imageNodes.forEach((node, index) => {
      try {
        if (index === 0) node.name = "@Main_Image";
        else node.name = `@Image_${index}`; 
      } catch(e) {
        console.warn("Failed to rename image node:", e);
      }
    });

    // --------------------------------------------------------
    // 4. 성공 알림
    // --------------------------------------------------------
    figma.notify("템플릿 레이어 자동 네이밍이 완료되었습니다! 🎉");

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    figma.notify("오류가 발생했습니다: " + errorMsg, { error: true });
    console.error("Plugin crashed:", err);
  } finally {
    // 성공/실패 여부와 상관없이 무조건 마지막에 플러그인 닫기
    figma.closePlugin();
  }
}

main();
