import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ListContainerProperty,
  ListItemContainerProperty,
  MenuContainerProperty,
  MenuItemProperty,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import type { Frame } from "./controller.js";
import { fitLine, wrap } from "./text.js";

function text(
  id: number,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  content: string,
  color: number,
  options: Partial<TextContainerProperty> = {},
) {
  return new TextContainerProperty({
    containerID: id,
    containerName: name,
    xPosition: x,
    yPosition: y,
    width: w,
    height: h,
    content: content || " ",
    textColor: color,
    ...options,
  });
}

function page(frame: Frame) {
  const y = frame.context ? 82 : 51;
  const height = 245 - y;
  const textObject = [
    text(
      1,
      "title",
      46,
      10,
      frame.badge ? 405 : 518,
      34,
      fitLine(frame.title, frame.badge ? 400 : 510),
      4,
    ),
    text(
      2,
      "badge",
      459,
      10,
      106,
      35,
      fitLine(frame.badge ?? "", 95),
      2,
      frame.badge
        ? { paddingLength: 2, borderWidth: 1, borderRadius: 5, borderColor: 4 }
        : {},
    ),
    text(
      3,
      "footer",
      12,
      253,
      552,
      35,
      fitLine(frame.footer, 548),
      frame.icon === "send" ? 4 : 2,
    ),
  ];
  if (frame.context) {
    textObject.push(
      text(5, "context", 12, 46, 552, 33, fitLine(frame.context, 540), 2),
    );
  }
  let listObject: ListContainerProperty[] = [];
  if (frame.native?.length) {
    listObject = [
      new ListContainerProperty({
        containerID: 6,
        containerName: "picker",
        xPosition: 12,
        yPosition: y,
        width: 552,
        height,
        isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemName: frame.native,
          itemCount: frame.native.length,
          itemWidth: 532,
          isItemSelectBorderEn: 1,
        }),
      }),
    ];
  } else if (frame.split) {
    const split = frame.split;
    const rowHeight = frame.context ? 47 : 53;
    for (let index = 0; index < 3; index++) {
      const selected = split.index === index;
      const label = split.rows[index];
      textObject.push(
        text(
          6 + index,
          "row" + index,
          12,
          y + index * rowHeight,
          224,
          39,
          label ? (selected ? "▶ " : "   ") + fitLine(label, 188) : " ",
          selected ? 4 : 2,
          { paddingLength: 3, isEventCapture: index === 0 ? 1 : 0 },
        ),
      );
    }
    const detail = wrap(split.detail, 286).slice(0, 4);
    textObject.push(
      text(
        9,
        "preview",
        248,
        y,
        316,
        height,
        [fitLine(split.heading, 286), ...detail].join("\n"),
        4,
        { paddingLength: 8, borderWidth: 1, borderRadius: 8, borderColor: 7 },
      ),
    );
  } else {
    textObject.push(
      text(6, "body", 12, y, 552, height, frame.body, 4, {
        isEventCapture: 1,
        ...(frame.icon === "send"
          ? {
              paddingLength: 8,
              borderWidth: 1,
              borderRadius: 8,
              borderColor: 10,
            }
          : {}),
      }),
    );
  }
  const imageObject = [
    new ImageContainerProperty({
      containerID: 4,
      containerName: "sectionIcon",
      xPosition: 12,
      yPosition: 11,
      width: 24,
      height: 24,
    }),
  ];
  const menuObject = frame.shortcuts?.length
    ? new MenuContainerProperty({
        menuItems: frame.shortcuts.map(
          (item) =>
            new MenuItemProperty({ itemID: item.id, itemName: item.label }),
        ),
      })
    : undefined;
  return {
    containerTotalNum:
      textObject.length + listObject.length + imageObject.length,
    textObject,
    listObject,
    imageObject,
    menuObject,
  };
}

export class GlassesDisplay {
  private shown?: Frame;
  private previous?: ReturnType<typeof page>;
  private icons = new Map<string, number[]>();
  constructor(private bridge: EvenAppBridge) {}
  get visibleFrame() {
    return this.shown;
  }

  async start(frame: Frame) {
    const layout = page(frame);
    const result = await this.bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer(layout),
    );
    if (result !== 0) throw new Error("Display refused startup.");
    this.previous = layout;
  }

  async render(frame: Frame) {
    const layout = page(frame);
    const previous = this.previous;
    const signature = (value: typeof layout) =>
      JSON.stringify([
        value.textObject.map(({ content, textColor, ...box }) => box),
        value.listObject,
        value.menuObject,
      ]);
    const rebuild = !previous || signature(previous) !== signature(layout);
    if (rebuild) {
      if (
        !(await this.bridge.rebuildPageContainer(
          new RebuildPageContainer(layout),
        ))
      )
        throw new Error("Glasses layout update failed.");
    } else {
      for (let i = 0; i < layout.textObject.length; i++) {
        const box = layout.textObject[i];
        const old = previous.textObject[i];
        if (old.content === box.content && old.textColor === box.textColor)
          continue;
        const updated = await this.bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: box.containerID,
            containerName: box.containerName,
            content: box.content,
            textColor: box.textColor,
          }),
        );
        if (!updated) throw new Error("Glasses text update failed.");
      }
    }
    const updateIcon = rebuild || this.shown?.icon !== frame.icon;
    this.previous = layout;
    this.shown = frame;
    if (updateIcon) await this.showIcon(frame.icon);
  }

  private async showIcon(name: string) {
    try {
      if (!this.icons.has(name)) {
        const response = await fetch("./g2/icons/" + name + ".png");
        if (!response.ok) return;
        this.icons.set(
          name,
          Array.from(new Uint8Array(await response.arrayBuffer())),
        );
      }
      await this.bridge.updateImageRawData(
        new ImageRawDataUpdate({
          containerID: 4,
          containerName: "sectionIcon",
          imageData: this.icons.get(name),
        }),
      );
    } catch {
      // The label and action remain available if an optional image cannot load.
    }
  }
}
