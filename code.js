function main() {
  // 1. 선택 유효성 검사
  const selection = figma.currentPage.selection;

  // 선택된 노드가 없거나, Frame / Component가 아닌 경우
  if (
    selection.length === 0 || 
    !(selection[0].type === "FRAME" || selection[0].type === "COMPONENT")
  ) {
    figma.notify("기준이 되는 프레임이나 컴포넌트를 선택해 주세요.", { error: true });
    figma.closePlugin();
    return; // <--- 이 부분에 리턴을 추가하여 플러그인 에러를 방지합니다.
  }

  const targetFrame = selection[0];

  // --------------------------------------------------------
  // 2. 텍스트 레이어 네이밍 규칙 적용
  // --------------------------------------------------------
  const textNodes = targetFrame.findAll(node => node.type === "TEXT");

  function getFontSize(textNode) {
    if (textNode.fontSize === figma.mixed) {
      return textNode.getRangeFontSize(0, 1) || 0;
    }
    return textNode.fontSize || 0;
  }

  textNodes.sort((a, b) => {
    const sizeA = getFontSize(a);
    const sizeB = getFontSize(b);
    
    if (sizeA !== sizeB) {
      return sizeB - sizeA;
    }
    
    const yA = a.absoluteBoundingBox ? a.absoluteBoundingBox.y : a.y;
    const yB = b.absoluteBoundingBox ? b.absoluteBoundingBox.y : b.y;
    
    if (Math.abs(yA - yB) > 1) {
      return yA - yB;
    }
    
    const xA = a.absoluteBoundingBox ? a.absoluteBoundingBox.x : a.x;
    const xB = b.absoluteBoundingBox ? b.absoluteBoundingBox.x : b.x;
    return xA - xB;
  });

  textNodes.forEach((node, index) => {
    if (index === 0) {
      node.name = "#Title";
    } else if (index === 1) {
      node.name = "#SubTitle";
    } else {
      node.name = `#Text_${index - 1}`;
    }
  });


  // --------------------------------------------------------
  // 3. 이미지 레이어 네이밍 규칙 적용
  // --------------------------------------------------------
  const imageNodes = targetFrame.findAll(node => {
    if ('fills' in node && Array.isArray(node.fills)) {
      return node.fills.some(fill => fill.type === "IMAGE");
    }
    return false;
  });

  imageNodes.sort((a, b) => {
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    
    if (areaA !== areaB) {
      return areaB - areaA;
    }
    
    const yA = a.absoluteBoundingBox ? a.absoluteBoundingBox.y : a.y;
    const yB = b.absoluteBoundingBox ? b.absoluteBoundingBox.y : b.y;
    
    if (Math.abs(yA - yB) > 1) {
      return yA - yB;
    }
    
    const xA = a.absoluteBoundingBox ? a.absoluteBoundingBox.x : a.x;
    const xB = b.absoluteBoundingBox ? b.absoluteBoundingBox.x : b.x;
    return xA - xB;
  });

  imageNodes.forEach((node, index) => {
    if (index === 0) {
      node.name = "@Main_Image";
    } else {
      node.name = `@Image_${index}`; 
    }
  });


  // --------------------------------------------------------
  // 4. 성공 알림 및 종료
  // --------------------------------------------------------
  figma.notify("템플릿 레이어 자동 네이밍이 완료되었습니다! 🎉");
  figma.closePlugin();
}

main();
