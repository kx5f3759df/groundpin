// ============================================================
// GroundPin — AttachmentsScreen
// ============================================================
//
// Displays a list of all undeleted attachments with:
//   - Type indicator (text/audio/photo/video)
//   - File name
//   - Evidence time
//   - File size
//   - Delete button (also deletes anchor JSON)
// ============================================================

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { AttachmentRecord } from '../types';
import * as AttachmentStore from '../storage/attachmentStore';

const TYPE_LABELS: Record<string, string> = {
  text: '文字',
  audio: '录音',
  photo: '拍照',
  video: '视频',
};

const TYPE_ICONS: Record<string, string> = {
  text: '📝',
  audio: '🎤',
  photo: '📷',
  video: '🎬',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatEvidenceTime(unixMs: number): string {
  const d = new Date(unixMs);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export default function AttachmentsScreen() {
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const data = await AttachmentStore.loadAttachments();
    setAttachments(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const handleDelete = useCallback((item: AttachmentRecord) => {
    Alert.alert(
      '删除附件',
      `确定删除 ${TYPE_LABELS[item.type] || item.type} 附件吗？\n\n${item.filename}`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            const deleted = await AttachmentStore.deleteAttachment(item.id);
            if (deleted) {
              await loadData();
            }
          },
        },
      ],
    );
  }, [loadData]);

  const renderItem = ({ item }: { item: AttachmentRecord }) => (
    <View style={styles.attachmentItem}>
      <View style={styles.attachmentIcon}>
        <Text style={styles.attachmentIconText}>
          {TYPE_ICONS[item.type] || '📄'}
        </Text>
      </View>
      <View style={styles.attachmentInfo}>
        <Text style={styles.attachmentType}>
          {TYPE_LABELS[item.type] || item.type}
        </Text>
        <Text style={styles.attachmentFilename} numberOfLines={1}>
          {item.filename}
        </Text>
        <Text style={styles.attachmentMeta}>
          {formatEvidenceTime(item.evidenceTimeUnixMs)} · {formatSize(item.sizeBytes)}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => handleDelete(item)}
      >
        <Text style={styles.deleteButtonText}>删除</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {attachments.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>暂无附件</Text>
          <Text style={styles.emptySubText}>
            在有效定位后，可以通过底部按钮添加文字、录音、照片、视频附件
          </Text>
        </View>
      ) : (
        <FlatList
          data={attachments}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await loadData();
            setRefreshing(false);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  listContent: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  attachmentIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  attachmentIconText: {
    fontSize: 22,
  },
  attachmentInfo: {
    flex: 1,
  },
  attachmentType: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  attachmentFilename: {
    color: '#a0a0b0',
    fontSize: 12,
    marginTop: 2,
  },
  attachmentMeta: {
    color: '#666680',
    fontSize: 11,
    marginTop: 2,
  },
  deleteButton: {
    backgroundColor: 'rgba(231,76,60,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  deleteButtonText: {
    color: '#e74c3c',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    color: '#a0a0b0',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubText: {
    color: '#666680',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
});
