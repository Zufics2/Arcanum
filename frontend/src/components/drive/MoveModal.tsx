"use client";

import { useQuery } from "@tanstack/react-query";
import { Modal, TreeSelect, type TreeSelectProps } from "antd";
import { useMemo, useState } from "react";

import { listFolderTree, type DriveItem, type FolderNode } from "@/lib/storage";

const ROOT = "__root__";

type TreeData = NonNullable<TreeSelectProps["treeData"]>;

function buildTree(nodes: FolderNode[], disabled: Set<string>): TreeData {
  const byParent = new Map<string | null, FolderNode[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  const build = (parentId: string | null): TreeData =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ru"))
      .map((node) => ({
        value: node.id,
        title: node.name ?? "⚠ не удалось расшифровать",
        disabled: disabled.has(node.id),
        children: build(node.id),
      }));
  return [{ value: ROOT, title: "Мой диск", children: build(null) }];
}

/** Ids of a folder and everything inside it: a folder cannot be moved there. */
function subtreeIds(nodes: FolderNode[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        grew = true;
      }
    }
  }
  return ids;
}

interface MoveModalProps {
  item: DriveItem;
  onSubmit: (targetFolderId: string | null) => Promise<void>;
  onClose: () => void;
}

export default function MoveModal({ item, onSubmit, onClose }: MoveModalProps) {
  const { data: nodes = [], isPending } = useQuery({ queryKey: ["tree"], queryFn: listFolderTree });
  const [target, setTarget] = useState<string>();
  const [saving, setSaving] = useState(false);

  const treeData = useMemo(
    () => buildTree(nodes, item.kind === "folder" ? subtreeIds(nodes, item.id) : new Set()),
    [nodes, item],
  );

  const submit = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await onSubmit(target === ROOT ? null : target);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={`Переместить «${item.name ?? "…"}»`}
      okText="Переместить"
      cancelText="Отмена"
      okButtonProps={{ disabled: !target }}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
    >
      <TreeSelect
        style={{ width: "100%" }}
        placeholder="Выберите папку"
        loading={isPending}
        treeData={treeData}
        treeDefaultExpandAll
        value={target}
        onChange={setTarget}
      />
    </Modal>
  );
}
