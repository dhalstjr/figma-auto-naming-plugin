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
  return Object.assign({}, node, {
    layout: node.layout || 'vertical',
    layoutRules: {
      grow: (node.layoutRules && node.layoutRules.grow) || 0,
      align: (node.layoutRules && node.layoutRules.align) || 'start',
      primaryAxisSizing: (node.style && node.style.width === 'fill') ? 'fill' : 'hug',
      counterAxisSizing: (node.style && node.style.height === 'fill') ? 'fill' : 'hug'
    }
  });
}

function flattenDepth(node) {
  if (node.type === 'frame' && node.children && node.children.length === 1) {
    const child = node.children[0];
    if (child.type === 'frame' && child.layout === node.layout) {
      return flattenDepth(Object.assign({}, child, {
        id: node.id
      }));
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
  return Object.assign({}, node, {
    style: Object.assign({}, node.style, {
      spacing: tokenize(node.style.spacing),
      padding: tokenize(node.style.padding)
    })
  });
}

function normalizeSize(node) {
  if (!node.style) return node;
  const formatSize = (sizeValue) => {
    if (sizeValue === 'fill' || sizeValue === 'hug') return sizeValue;
    if (typeof sizeValue === 'number' || !isNaN(Number(sizeValue))) {
      return { type: 'fixed', value: Number(sizeValue) };
    }
    return 'hug';
  };
  return Object.assign({}, node, {
    style: Object.assign({}, node.style, {
      width: formatSize(node.style.width),
      height: formatSize(node.style.height)
    })
  });
}

function assignBaseRole(node) {
  let role = (node.role && node.role !== 'default') ? node.role : 'container';
  if (node.type === 'text') {
    role = 'text';
    const content = node.content || '';
    if (/^[0-9,]+$/.test(content.trim())) role = 'price';
    if (['만', '원', '회', '개', '%'].includes(content.trim())) role = 'unit';
  } else if (node.type === 'image') {
    role = 'thumbnail';
  }
  return Object.assign({}, node, { role: role });
}

function normalizeTree(rawNode) {
  if (!rawNode) return null;

  let node = normalizeSize(rawNode);
  node = applySpacingTokens(node);
  node = applyLayoutRules(node);
  node = assignBaseRole(node);

  if (node.children && Array.isArray(node.children)) {
    node.children = node.children
      .map(child => normalizeTree(child))
      .filter(Boolean);
  }

  node = flattenDepth(node);

  return node;
}

async function enhanceRolesWithAI(node) {
  const applyAIRoles = (n) => {
    const updatedNode = Object.assign({}, n);
    if (n.children) {
      updatedNode.children = n.children.map(applyAIRoles);
    }
    return updatedNode;
  };
  return applyAIRoles(node);
}

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
      // 생성된 노드로 화면 이동
      figma.currentPage.selection = [renderedNode];
      figma.viewport.scrollAndZoomIntoView([renderedNode]);
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


// --- [Phase 4: AI Layer - Templateization & Data Binding Engine] ---

const TEMPLATE_REGISTRY = {
  "product_card": {
    "type": "frame",
    "layout": { "mode": "VERTICAL", "padding": "token.spacing.md", "spacing": "token.spacing.sm" },
    "style": { "width": "hug", "height": "hug" },
    "children": [
      { "type": "image", "content": "{{imageUrl}}", "style": { "width": { "type": "fixed", "value": 200 }, "height": { "type": "fixed", "value": 200 } } },
      { "type": "text", "content": "{{title}}", "style": { "width": "fill", "height": "hug" } },
      { "type": "text", "content": "{{price}}원", "style": { "width": "fill", "height": "hug" } }
    ]
  },
  "promotion_banner": {
    "type": "frame",
    "layout": { "mode": "HORIZONTAL", "padding": "token.spacing.lg", "spacing": "token.spacing.md" },
    "style": { "width": "fill", "height": { "type": "fixed", "value": 120 } },
    "children": [
      {
        "type": "frame", "layout": { "mode": "VERTICAL", "padding": "token.spacing.none", "spacing": "token.spacing.xs" }, "style": { "width": "fill", "height": "hug" },
        "children": [
          { "type": "text", "content": "{{badge}}", "style": { "width": "hug", "height": "hug" } },
          { "type": "text", "content": "{{headline}}", "style": { "width": "fill", "height": "hug" } }
        ]
      },
      { "type": "text", "content": "{{cta_text}}", "style": { "width": "hug", "height": "hug" } }
    ]
  },
  "list_ui": {
    "type": "frame",
    "layout": { "mode": "HORIZONTAL", "padding": "token.spacing.md", "spacing": "token.spacing.md" },
    "style": { "width": "fill", "height": "hug" },
    "children": [
      { "type": "text", "content": "{{index}}.", "style": { "width": { "type": "fixed", "value": 24 }, "height": "hug" } },
      { "type": "text", "content": "{{item_name}}", "style": { "width": "fill", "height": "hug" } },
      { "type": "text", "content": "{{status}}", "style": { "width": "hug", "height": "hug" } }
    ]
  }
};

function selectTemplateByRule(inputKeyword) {
  const keyword = String(inputKeyword).trim().toLowerCase();
  if (keyword.includes("상품") || keyword.includes("product")) return "product_card";
  if (keyword.includes("배너") || keyword.includes("banner")) return "promotion_banner";
  if (keyword.includes("리스트") || keyword.includes("list") || keyword.includes("목록")) return "list_ui";
  return "product_card"; // Default Fallback
}

function bindDataToTemplate(templateObj, data) {
  const result = JSON.parse(JSON.stringify(templateObj));

  function traverseAndBind(obj) {
    if (typeof obj === "string") {
      return obj.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
        const dataValue = data[key.trim()];
        return (dataValue !== undefined && dataValue !== null) ? String(dataValue) : "";
      });
    } else if (Array.isArray(obj)) {
      return obj.map(item => traverseAndBind(item));
    } else if (typeof obj === "object" && obj !== null) {
      const boundObj = {};
      for (const k in obj) {
        boundObj[k] = traverseAndBind(obj[k]);
      }
      return boundObj;
    }
    return obj;
  }

  return traverseAndBind(result);
}

function generateSSOT(keyword, extractedData) {
  const templateId = selectTemplateByRule(keyword);
  const template = TEMPLATE_REGISTRY[templateId];
  return bindDataToTemplate(template, extractedData);
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
      const oldStrokes = node.strokes ? node.strokes.slice() : [];
      const oldWeight = node.strokeWeight;
      node.strokes = [{ type: 'SOLID', color: { r: 0.09, g: 0.62, b: 0.98 } }];
      node.strokeWeight = Math.max(3, oldWeight * 2);
      setTimeout(() => {
        try { node.strokes = oldStrokes; node.strokeWeight = oldWeight; } catch (e) { }
      }, 800);
    } catch (e) { }
  }

  async function getGroupedFields() {
    let result = [];
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

    result = result.concat(standaloneFields);

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

    // ⭐️ 렌더링 엔진 실행
    if (msg.type === 'EXTRACT_JSON') {
      const selection = figma.currentPage.selection;
      if (selection.length > 0) {
        const rawJSON = extractNodeToJSON(selection[0]);
        const ssotJSON = await processFigmaJSON(rawJSON);

        console.log("Extracted & Normalized SSOT JSON:", JSON.stringify(ssotJSON, null, 2));
        figma.ui.postMessage({ type: 'extracted-json', data: ssotJSON });

        figma.notify("SSOT JSON 정제 완료! 렌더링을 시작합니다...", { timeout: 2000 });
        await renderFromSSOT(ssotJSON);

      } else {
        figma.notify("추출할 프레임을 선택해주세요.", { error: true });
      }
    }

    if (msg.type === 'close') figma.closePlugin();
  };
}

main();