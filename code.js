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
    // 플러그인 UI (HTML) 브릿지 호출 및 통신 로직
    // --------------------------------------------------------
    
    // UI에 전달할 그룹화된 필드 생성
    function getGroupedFields() {
      const finalTexts = targetFrame.findAll(node => 
        node.type === "TEXT" && 
        isEditableNode(node) && 
        (node.name.startsWith("#") || node.name === "#Title" || node.name === "#SubTitle")
      );
      finalTexts.sort(sortByCoordinates);

      const fieldGroupsMap = {};
      for (const t of finalTexts) {
        let p = t.parent;
        let groupName = "기본 템플릿 영역";
        let groupId = targetFrame.id; 
        
        // Layout_N 이라는 프레임을 찾아서 해당 그룹으로 귀속
        while (p && p !== targetFrame.parent) {
          if (p.name.startsWith("Layout_")) {
            groupName = p.name;
            groupId = p.id;
            break;
          }
          p = p.parent;
        }
        
        if (!fieldGroupsMap[groupId]) {
          fieldGroupsMap[groupId] = {
            groupId: groupId,
            groupName: groupName,
            fields: []
          };
        }
        
        // Semantic Labeling: 첫 10글자 추출
        let semanticLabel = t.characters.substring(0, 10).replace(/\n/g, ' ');
        if (t.characters.length > 10) semanticLabel += "...";
        if (t.name === "#Title") semanticLabel = `👑 ` + semanticLabel;

        fieldGroupsMap[groupId].fields.push({
          id: t.id,
          name: t.name,
          semanticLabel: semanticLabel,
          characters: t.characters
        });
      }
      return Object.values(fieldGroupsMap);
    }

    // 🌟 HTML UI 랜더링 
    figma.showUI(__html__, { width: 340, height: 600, themeColors: true });
    
    // 초기 필드 전송
    figma.ui.postMessage({ type: 'init-fields', groups: getGroupedFields() });

    // HTML 버튼 클릭 및 메시지 수신 (양방향 연결)
    figma.ui.onmessage = async (msg) => {
      
      // Focus Mode 로직 추가
      if (msg.type === 'focus-node') {
        const node = figma.getNodeById(msg.id);
        if (node) {
          figma.currentPage.selection = [node];
          figma.viewport.scrollAndZoomIntoView([node]);
        }
      }

      // Repeater (Clone) 로직 추가
      if (msg.type === 'clone-group') {
        const nodeToClone = figma.getNodeById(msg.id);
        if (nodeToClone && nodeToClone.type === "FRAME" && nodeToClone.parent) {
          const clone = nodeToClone.clone();
          const index = nodeToClone.parent.children.indexOf(nodeToClone);
          nodeToClone.parent.insertChild(index + 1, clone); // 바로 밑에 삽입
          
          figma.notify(`➕ [${nodeToClone.name}] 세트가 성공적으로 복제되었습니다.`);
          
          // 새로 추가된 요소를 포함하여 UI 폼 전면 갱신
          figma.ui.postMessage({ type: 'init-fields', groups: getGroupedFields() });
        }
      }

      // 텍스트 일괄 업데이트 로직
      if (msg.type === 'update-texts') {
        let successCount = 0;
        for (const update of msg.updates) {
          const node = figma.getNodeById(update.id);
          if (node && node.type === "TEXT" && node.characters !== update.characters) {
            try {
              // Technical Defense: Mixed Inline Styles 안전 처리
              // 노드에 적용된 모든 다양한 폰트 종류를 불러와 충돌을 원천 방지합니다.
              const fontsToLoad = node.getRangeAllFontNames(0, node.characters.length);
              for (const font of fontsToLoad) {
                await figma.loadFontAsync(font);
              }
              
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
    figma.closePlugin(); 
  }
}

main();
