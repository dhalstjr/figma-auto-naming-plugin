// --- [Phase 1: SSOT JSON 추출 유틸리티 함수 (Raw Data)] ---
function reverseTokenizeSpacing(value) {
  if (typeof value !== 'number' || value === 0) return "token.spacing.none";
  if (value <= 4) return "token.spacing.xs";
  if (value <= 8) return "token.spacing.sm";
  if (value <= 16) return "token.spacing.md";
  if (value <= 24) return "token.spacing.lg";
  if (value <= 32) return "token.spacing.xl";
  return "token.spacing.xxl";
}

function getSizingMode(node, axis) {
  if (axis === "HORIZONTAL") {
    if (node.layoutSizingHorizontal === "FILL" || node.layoutGrow === 1) return "fill";
    if (node.layoutSizingHorizontal === "HUG") return "hug";
    return "fixed";
  } else {
    if (node.layoutSizingVertical === "FILL" || node.layoutAlign === "STRETCH") return "fill";
    if (node.layoutSizingVertical === "HUG") return "hug";
    return "fixed";
  }
}

function determineRole(node) {
  const name = (node.name || "").toLowerCase();
  if (name.includes("thumbnail") || name.includes("thumb")) return "thumbnail";
  if (name.includes("title")) return "title";
  if (name.includes("desc") || name.includes("sub")) return "description";
  if (name.includes("btn") || name.includes("button")) return "button";
  if (name.includes("icon")) return "icon";
  return "default";
}

function determineType(node) {
  if (node.type === "TEXT") return "text";
  const isImageFill = node.fills && Array.isArray(node.fills) && node.fills.some(f => f.type === "IMAGE");
  if (node.type === "IMAGE" || isImageFill) return "image";
  if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE") return "frame";
  if (node.type === "GROUP") return "container";
  return "container";
}

function extractNodeToJSON(node) {
  const nodeType = determineType(node);
  const json = {
    id: node.id,
    type: nodeType
  };

  if (nodeType === "frame" || nodeType === "container") {
    json.layout = node.layoutMode === "HORIZONTAL" ? "horizontal" : (node.layoutMode === "VERTICAL" ? "vertical" : "none");
    json.children = [];
    if (node.children && node.children.length > 0) {
      json.children = node.children.map(child => extractNodeToJSON(child));
    }

    if (node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL") {
      json.style = {
        width: getSizingMode(node, "HORIZONTAL"),
        height: getSizingMode(node, "VERTICAL"),
        spacing: reverseTokenizeSpacing(node.itemSpacing),
        padding: reverseTokenizeSpacing(Math.max(node.paddingLeft || 0, node.paddingTop || 0))
      };
    }
  }

  if (nodeType === "image" || nodeType === "text" || nodeType === "container") {
    json.role = determineRole(node);
    if (nodeType === "text") {
      json.content = node.characters || "";
    }

    json.style = json.style || {};
    json.style.width = getSizingMode(node, "HORIZONTAL");
    json.style.height = getSizingMode(node, "VERTICAL");

    let alignMode = "start";
    if (node.layoutAlign === "CENTER") alignMode = "center";
    if (node.layoutAlign === "MAX") alignMode = "end";

    json.layoutRules = {
      grow: node.layoutGrow || 0,
      align: alignMode
    };

    if (nodeType === "image") {
      const w = Math.round(node.width || 1);
      const h = Math.round(node.height || 1);
      json.layoutRules.ratio = (w === h) ? "1:1" : "16:9";
    }
  }

  return json;
}

// --- [Phase 2: Normalize Engine (데이터 정제 및 의미 보완)] ---

function applyLayoutRules(node) {
  if (node.type !== 'frame') return node;
  return {
    ...node,
    layout: node.layout || 'vertical',
    layoutRules: {
      grow: (node.layoutRules && node.layoutRules.grow) || 0,
      align: (node.layoutRules && node.layoutRules.align) || 'start',
      primaryAxisSizing: (node.style && node.style.width === 'fill') ? 'fill' : 'hug',
      counterAxisSizing: (node.style && node.style.height === 'fill') ? 'fill' : 'hug'
    }
  };
}

function flattenDepth(node) {
  // 의미 없는 중첩 프레임(부모와 자식의 레이아웃이 같고 자식이 하나뿐인 경우) 제거
  if (node.type === 'frame' && node.children && node.children.length === 1) {
    const child = node.children[0];
    if (child.type === 'frame' && child.layout === node.layout) {
      return flattenDepth({
        ...child,
        id: node.id // 기존 상위 프레임의 ID를 보존하여 추적 유지
      });
    }
  }
  return node;
}

function applySpacingTokens(node) {
  if (!node.style) return node;
  const tokenize = (val) => {
    if (typeof val === 'string' && val.includes('token')) return val;
    if (!val || val === 0) return 'token.spacing.none';
    if (val <= 4) return 'token.spacing.xs';
    if (val <= 8) return 'token.spacing.sm';
    if (val <= 16) return 'token.spacing.md';
    if (val <= 24) return 'token.spacing.lg';
    return 'token.spacing.xl';
  };
  return {
    ...node,
    style: {
      ...node.style,
      spacing: tokenize(node.style.spacing),
      padding: tokenize(node.style.padding)
    }
  };
}

function normalizeSize(node) {
  if (!node.style) return node;
  const formatSize = (sizeValue) => {
    if (sizeValue === 'fill' || sizeValue === 'hug') return sizeValue;
    if (typeof sizeValue === 'number' || !isNaN(Number(sizeValue))) {
      return { type: 'fixed', value: Number(sizeValue) };
    }
    return 'hug'; // 값이 불분명할 경우 기본 fallback
  };
  return {
    ...node,
    style: {
      ...node.style,
      width: formatSize(node.style.width),
      height: formatSize(node.style.height)
    }
  };
}

function assignBaseRole(node) {
  let role = (node.role && node.role !== 'default') ? node.role : 'container';
  if (node.type === 'text') {
    role = 'text'; // 임시 텍스트 롤
    const content = node.content || '';
    if (/^[0-9,]+$/.test(content.trim())) role = 'price';
    if (['만', '원', '회', '개', '%'].includes(content.trim())) role = 'unit';
  } else if (node.type === 'image') {
    role = 'thumbnail';
  }
  return { ...node, role };
}

function normalizeTree(rawNode) {
  if (!rawNode) return null;

  // 1. 노드 자체 속성 정규화 (구조 보정)
  let node = normalizeSize(rawNode);
  node = applySpacingTokens(node);
  node = applyLayoutRules(node);
  node = assignBaseRole(node);

  // 2. 자식 노드 재귀 순회
  if (node.children && Array.isArray(node.children)) {
    node.children = node.children
      .map(child => normalizeTree(child))
      .filter(Boolean);
  }

  // 3. 트리 뎁스 최적화 (Bottom-Up 적용)
  node = flattenDepth(node);

  return node;
}

async function enhanceRolesWithAI(node) {
  // 향후 외부 LLM API와 연동될 의미 보완 계층 (AI Layer)
  // 현재는 구조를 해치지 않고 그대로 반환하는 파이프라인만 구축해둠
  const applyAIRoles = (n) => {
    const updatedNode = { ...n };
    if (n.children) {
      updatedNode.children = n.children.map(applyAIRoles);
    }
    return updatedNode;
  };
  return applyAIRoles(node);
}

// 메인 프로세서: Raw -> Normalize -> AI Enhance -> 최종 반환
async function processFigmaJSON(rawJSON) {
  const normalized = normalizeTree(rawJSON);
  const enhanced = await enhanceRolesWithAI(normalized);
  return enhanced;
}


// --- [Phase 3: Render Engine (JSON to Auto Layout)] ---

const TOKEN_DICTIONARY = {
  "token.spacing.xs": 4,
  "token.spacing.sm": 8,
  "token.spacing.md": 16,
  "token.spacing.lg": 24,
  "token.spacing.xl": 32,
  "token.spacing.none": 0
};

function resolveToken(value) {
  if (typeof value === "string" && TOKEN_DICTIONARY[value] !== undefined) {
    return TOKEN_DICTIONARY[value];
  }
  return typeof value === "number" ? value : 0;
}

function createFrame(node) {
  return figma.createFrame();
}

async function createText(node) {
  const textNode = figma.createText();
  
  const family = (node.fontName && node.fontName.family) ? String(node.fontName.family) : "Inter";
  const style = (node.fontName && node.fontName.style) ? String(node.fontName.style) : "Regular";

  await figma.loadFontAsync({ family, style });

  if (node.fontName) {
    textNode.fontName = { family, style };
  }

  if (node.characters !== undefined) {
    textNode.characters = String(node.characters);
  } else if (node.content !== undefined) {
    textNode.characters = String(node.content);
  }

  if (node.fontSize !== undefined) {
    textNode.fontSize = Number(node.fontSize);
  }

  if (node.color) {
    textNode.fills = [{ type: 'SOLID', color: node.color }];
  }

  return textNode;
}

function createImage(node) {
  const rect = figma.createRectangle();
  rect.fills = [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }];
  return rect;
}

function applyLayout(node, figmaNode) {
  if (node.layout && figmaNode.type === "FRAME") {
    if (node.layout.mode) {
      figmaNode.layoutMode = String(node.layout.mode).toUpperCase();
    }
    if (node.layout.spacing !== undefined) {
      figmaNode.itemSpacing = resolveToken(node.layout.spacing);
    }
    if (node.layout.padding !== undefined) {
      const p = node.layout.padding;
      if (typeof p === "string" || typeof p === "number") {
        const val = resolveToken(p);
        figmaNode.paddingTop = val;
        figmaNode.paddingRight = val;
        figmaNode.paddingBottom = val;
        figmaNode.paddingLeft = val;
      } else if (typeof p === "object") {
        if (p.top !== undefined) figmaNode.paddingTop = resolveToken(p.top);
        if (p.bottom !== undefined) figmaNode.paddingBottom = resolveToken(p.bottom);
        if (p.left !== undefined) figmaNode.paddingLeft = resolveToken(p.left);
        if (p.right !== undefined) figmaNode.paddingRight = resolveToken(p.right);
      }
    }
  }

  if (node.layoutRules) {
    const isParentAutoLayout = figmaNode.parent && "layoutMode" in figmaNode.parent && figmaNode.parent.layoutMode !== "NONE";
    if (isParentAutoLayout && "layoutGrow" in figmaNode) {
      if (node.layoutRules.grow !== undefined) {
        figmaNode.layoutGrow = Number(node.layoutRules.grow);
      }
      if (node.layoutRules.align !== undefined && "layoutAlign" in figmaNode) {
        figmaNode.layoutAlign = String(node.layoutRules.align).toUpperCase();
      }
    }
  }
}

function applyStyle(node, figmaNode) {
  if (!node.style) return;

  const isParentAutoLayout = figmaNode.parent && "layoutMode" in figmaNode.parent && figmaNode.parent.layoutMode !== "NONE";
  let hasFillOrHug = false;

  if (node.style.width !== undefined) {
    const w = String(node.style.width).toLowerCase();
    if (w === "fill" || w === "hug") {
      if (isParentAutoLayout && "layoutSizingHorizontal" in figmaNode) {
        figmaNode.layoutSizingHorizontal = w.toUpperCase();
      }
      hasFillOrHug = true;
    }
  }

  if (node.style.height !== undefined) {
    const h = String(node.style.height).toLowerCase();
    if (h === "fill" || h === "hug") {
      if (isParentAutoLayout && "layoutSizingVertical" in figmaNode) {
        figmaNode.layoutSizingVertical = h.toUpperCase();
      }
      hasFillOrHug = true;
    }
  }

  if (!hasFillOrHug) {
    const widthIsNum = typeof node.style.width === "number";
    const heightIsNum = typeof node.style.height === "number";
    if (widthIsNum || heightIsNum) {
      if ("resize" in figmaNode) {
        const targetW = widthIsNum ? Number(node.style.width) : (figmaNode.width || 1);
        const targetH = heightIsNum ? Number(node.style.height) : (figmaNode.height || 1);
        figmaNode.resize(targetW, targetH);
      }
    }
  }
}

async function renderNode(node, parent) {
  if (!node || !node.type) return null;
  const t = String(node.type).toLowerCase();
  let figmaNode = null;

  if (t === "frame" || t === "container") {
    figmaNode = createFrame(node);
  } else if (t === "text") {
    figmaNode = await createText(node);
  } else if (t === "image") {
    figmaNode = createImage(node);
  }

  if (!figmaNode) return null;

  if (parent) {
    parent.appendChild(figmaNode);
  }

  applyLayout(node, figmaNode);
  applyStyle(node, figmaNode);

  if ((t === "frame" || t === "container") && Array.isArray(node.children)) {
    await Promise.all(node.children.map((child) => renderNode(child, figmaNode)));
  }

  return figmaNode;
}

async function renderFromSSOT(json) {
  try {
    const renderedNode = await renderNode(json, null);
    if (renderedNode && renderedNode.type === "FRAME") {
      figma.currentPage.appendChild(renderedNode);
      return renderedNode;
    }
    return null;
  } catch (error) {
    if (figma && figma.notify) {
      figma.notify("Error: " + error.message, { error: true });
    }
    return null;
  }
}


// --- [UI 통신 및 플러그인 초기화 (Main Logic)] ---

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
    const rowCardsMap = new Map();
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
      if (!isImage) {
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
                  node.setRangeFills(0, len, [{ type: 'SOLID', color: { r, g, b } }]);
                } else {
                  node.fills = [{ type: 'SOLID', color: { r, g, b } }];
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

    // ⭐️ 변경된 부분: EXTRACT_JSON 이벤트에서 Normalize 파이프라인 호출
    if (msg.type === 'EXTRACT_JSON') {
      const selection = figma.currentPage.selection;
      if (selection.length > 0) {
        // 1. Raw 추출
        const rawJSON = extractNodeToJSON(selection[0]);

        // 2. Normalize & AI 정제 파이프라인 통과
        const ssotJSON = await processFigmaJSON(rawJSON);

        console.log("Extracted & Normalized SSOT JSON:", JSON.stringify(ssotJSON, null, 2));
        figma.ui.postMessage({ type: 'extracted-json', data: ssotJSON });
        figma.notify("SSOT JSON 정제 완료!", { timeout: 2000 });
      } else {
        figma.notify("추출할 프레임을 선택해주세요.", { error: true });
      }
    }

    if (msg.type === 'close') figma.closePlugin();
  };
}

main();