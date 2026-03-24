async function main() {
  try {
    const selection = figma.currentPage.selection;
    if (selection.length === 0 || !(selection[0].type === "FRAME" || selection[0].type === "COMPONENT" || selection[0].type === "INSTANCE")) {
      figma.notify("기준이 되는 프레임이나 컴포넌트를 선택해 주세요.", { error: true });
      figma.closePlugin();
      return;
    }

    const targetFrame = selection[0];
    openUI(targetFrame);
  } catch (err) {
    console.error(err);
    figma.closePlugin();
  }
}

async function openUI(targetFrame) {
  function highlightNode(node) {
    try {
      const oldStrokes = [...node.strokes];
      const oldWeight = node.strokeWeight;
      node.strokes = [{ type: 'SOLID', color: { r: 0.09, g: 0.62, b: 0.98 } }];
      node.strokeWeight = Math.max(3, oldWeight * 2);
      setTimeout(() => {
        try { node.strokes = oldStrokes; node.strokeWeight = oldWeight; } catch (e) { }
      }, 800);
    } catch (e) { }
  }

  async function getGroupedFields() {
    const result = [];
    const processedNodes = new Set();
    const rowCardsMap = new Map(); // key: Layout_ frame ID
    const standaloneFields = [];

    const allNodes = targetFrame.findAll(n => n.type === "TEXT" || n.type === "IMAGE" || (n.fills && Array.isArray(n.fills) && n.fills.some(f => f.type === "IMAGE")));

    for (const node of allNodes) {
       if (processedNodes.has(node.id)) continue;
       processedNodes.add(node.id);

       let parentRow = null;
       let curr = node.parent;
       while (curr && curr !== targetFrame && curr.type !== "PAGE") {
          if (curr.type === "FRAME" && curr.layoutMode === "VERTICAL" && curr.name.startsWith("Layout_")) {
             parentRow = curr;
             break;
          }
          curr = curr.parent;
       }

       let isImage = node.type === "IMAGE" || (node.fills && Array.isArray(node.fills) && node.fills.some(f => f.type === "IMAGE"));
       
       let fieldData = null;
       if (!isImage) { // Must be TEXT
          let fSize = 12; let fWeight = "Regular"; let fColor = "#000000";
          if (node.fontSize !== figma.mixed) fSize = node.fontSize;
          if (node.fontName !== figma.mixed) fWeight = node.fontName.style;
          if (node.fills !== figma.mixed && node.fills.length > 0 && node.fills[0].type === 'SOLID') {
             const r = Math.round(node.fills[0].color.r * 255).toString(16).padStart(2, '0');
             const g = Math.round(node.fills[0].color.g * 255).toString(16).padStart(2, '0');
             const b = Math.round(node.fills[0].color.b * 255).toString(16).padStart(2, '0');
             fColor = `#${r}${g}${b}`.toUpperCase();
          } else { fColor = "mixed"; }

          fieldData = {
            id: node.id, type: "FIELD", fieldType: "TEXT",
            characters: node.characters, label: node.characters.substring(0, 10).replace(/\n/g, ' ') || "텍스트",
            fontSize: fSize, fontWeight: fWeight, fillColor: fColor,
            visible: node.visible
          };
       } else {
          fieldData = {
            id: node.id, type: "FIELD", fieldType: "IMAGE",
            label: "이미지 변경", visible: node.visible
          };
       }

       if (parentRow) {
          if (!rowCardsMap.has(parentRow.id)) {
             rowCardsMap.set(parentRow.id, { node: parentRow, fields: [] });
          }
          rowCardsMap.get(parentRow.id).fields.push(fieldData);
       } else {
          standaloneFields.push(fieldData);
       }
    }

    // Convert Map back to array format
    for (const [rowId, data] of rowCardsMap.entries()) {
        const rowNode = data.node;
        const fields = data.fields;
        
        let longestText = "";
        let numberAttr = "";
        fields.forEach(f => {
          if (f.fieldType === "TEXT") {
             if (f.characters.length > longestText.length) longestText = f.characters;
             const lowerT = f.characters.toLowerCase();
             if (/[0-9]/.test(lowerT) && (lowerT.includes('만') || lowerT.includes('원') || lowerT.includes('샷') || lowerT.includes('회') || lowerT.includes('%'))) {
               if (!numberAttr || f.characters.length < numberAttr.length) numberAttr = f.characters;
             }
          }
        });

        let mainLabel = longestText.substring(0, 10).replace(/\n/g, ' ');
        if (longestText.length > 10) mainLabel += "...";
        const autoName = numberAttr ? `🏷️ [${mainLabel}] ${numberAttr.substring(0, 8).replace(/\n/g, '')}` : `🏷️ [${mainLabel}] 그룹`;

        result.push({
          type: "ROW_CARD", id: rowNode.id, name: rowNode.name, autoName: autoName,
          visible: rowNode.visible, fields: fields
        });
    }

    result.push(...standaloneFields);
    
    return result;
  }

  figma.showUI(__html__, { width: 380, height: 680, themeColors: true });
  figma.ui.postMessage({ type: 'init-fields', groups: await getGroupedFields() });

  figma.on("selectionchange", () => {
    const selectionIds = figma.currentPage.selection.map(n => n.id);
    figma.ui.postMessage({ type: 'selection-changed', ids: selectionIds });
  });

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
          const clone = targetNode.clone();
          targetNode.parent.insertChild(targetNode.parent.children.indexOf(targetNode) + 1, clone);
          clone.visible = true;
          figma.notify(`➕ 항목이 복제되었습니다.`);
          figma.ui.postMessage({ type: 'init-fields', groups: await getGroupedFields() });
        } catch (e) { figma.notify("복제 오류 발생", { error: true }); }
      }
    }

    if (msg.type === 'soft-delete-group') {
      const targetNode = figma.getNodeById(msg.id);
      if (targetNode) {
        targetNode.visible = false;
        figma.notify(`👁️ 숨김 처리되었습니다.`);
        figma.ui.postMessage({ type: 'init-fields', groups: await getGroupedFields() });
      }
    }

    if (msg.type === 'restore-group') {
      const targetNode = figma.getNodeById(msg.id);
      if (targetNode) {
        targetNode.visible = true;
        figma.notify(`🚀 성공적으로 복구되었습니다.`);
        figma.ui.postMessage({ type: 'init-fields', groups: await getGroupedFields() });
      }
    }

    if (msg.type === 'hard-delete-group') {
      const targetNode = figma.getNodeById(msg.id);
      if (targetNode) {
        targetNode.remove();
        figma.notify(`🗑️ 영구 삭제되었습니다.`);
        figma.ui.postMessage({ type: 'init-fields', groups: await getGroupedFields() });
      }
    }

    if (msg.type === 'update-texts') {
      let successCount = 0;
      for (const update of msg.updates) {
        const node = figma.getNodeById(update.id);
        if (node && node.type === "TEXT") {
          try {
            let changed = false;
            
            if (update.characters !== undefined && node.characters !== update.characters) {
               if (!node.hasMissingFont) {
                 const len = node.characters.length;
                 if (len > 0) {
                   const fontsToLoad = node.getRangeAllFontNames(0, len);
                   for (const f of fontsToLoad) await figma.loadFontAsync(f);
                 }
                 node.characters = update.characters;
                 changed = true;
               }
            }
            
            if (update.fillHex && update.fillHex !== "MIXED") {
               const hex = update.fillHex;
               if (/^#[0-9A-F]{6}$/i.test(hex)) {
                  const r = parseInt(hex.substr(1, 2), 16) / 255;
                  const g = parseInt(hex.substr(3, 2), 16) / 255;
                  const b = parseInt(hex.substr(5, 2), 16) / 255;
                  
                  const len = node.characters.length;
                  if (len > 0) {
                     node.setRangeFills(0, len, [{type: 'SOLID', color: {r, g, b}}]);
                  } else {
                     node.fills = [{type: 'SOLID', color: {r, g, b}}];
                  }
                  changed = true;
               }
            }
            
            if (changed) successCount++;
          } catch (e) { }
        }
      }
      figma.notify(`✨ ${successCount}건 업데이트 완료!`);
    }

    if (msg.type === 'close') figma.closePlugin();
  };
}

main();