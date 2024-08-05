// references https://github.com/mengzonefire/baidupan-rapidupload/blob/master/common/Tools.js

/*
 * @Author: mengzonefire
 * @Date: 2021-10-14 16:36:56
 * @LastEditTime: 2023-03-16 14:21:39
 * @LastEditors: mengzonefire
 * @Description: 共用JS工具库
 */
export const bdlinkPattern = /#bdlink=([\da-z+/=]+)/iu; // b64可能出现的字符: 大小写字母a-zA-Z, 数字0-9, +, /, = (=用于末尾补位)

/**
 * @typedef {{
 *  md5: string
 *  md5s?: string
 *  size: string
 *  path: string
 *  ver?: string
 * }} MD5Info
 */

import { decryptMd5 } from '@netdisk-sdk/baidu-sdk';
import { fromBase64 } from 'js-base64'

/**
 * @param {string} url
 * @description: 从url中解析秒传链接
 */
export const parseQueryLink = (url) => {
    const bdlinkB64 = url.match(bdlinkPattern)?.[1] || '';
    return fromBase64(bdlinkB64)
}

/**
 * @description: 秒传链接解析器
 */
export class DuParser {
    /** 
     * @param {string} szUrl
     * @returns {MD5Info[]}
     */
    static parse(szUrl) {
        let r;
        if (szUrl.startsWith("bdpan")) {
            r = DuParser.parsePanDL(szUrl);
            r.ver = "PanDL";
        } else if (szUrl.startsWith("BaiduPCS-Go")) {
            r = DuParser.parsePCSGo(szUrl);
            r.ver = "PCS-Go";
        } else if (szUrl.startsWith("BDLINK")) {
            r = DuParser.parse游侠(szUrl);
            r.ver = "游侠 v1";
        } else {
            r = DuParser.parse梦姬(szUrl);
            r.ver = "梦姬标准";
        }
        return r;
    }
    /** 
     * @param {string} szUrl
     * @returns {MD5Info[]}
     */
    static parsePanDL(szUrl) {
        return szUrl.replace(/\s*bdpan:\/\//gu, " ")
            .trim()
            .split(" ")
            .map(z => fromBase64(z.trim()).match(/([\s\S]+)\|([\d]{1,20})\|([\da-f]{32})\|([\da-f]{32})/iu))
            .filter(Boolean)
            .map((info) => ({
                md5: info[3].toLowerCase(),
                md5s: info[4].toLowerCase(),
                size: parseInt(info[2]),
                path: info[1],
            }));
    }
    /** 
     * @param {string} szUrl
     * @returns {MD5Info[]}
     */
    static parsePCSGo(szUrl) {
        return szUrl
            .split("\n")
            .map((z) => z.trim().match(/-length=([\d]{1,20}) -md5=([\da-f]{32}) -slicemd5=([\da-f]{32}) (?:-crc32=\d{1,20} )?"(.+)/iu))
            .filter(Boolean)
            .map((info) => ({
                md5: info[2].toLowerCase(),
                md5s: info[3].toLowerCase(),
                size: parseInt(info[1]),
                path: info[4],
            }));
    }
    /** 
     * @param {string} szUrl
     * @returns {MD5Info[]}
     */
    static parse游侠(szUrl) {
        const raw = fromBase64(szUrl.slice(6).replace(/\s/gu, ""));
        if (raw.slice(0, 5) !== "BDFS\x00") return null;

        const buf = new SimpleBuffer(raw);
        let ptr = 9;
        const arrFiles = [];
        const total = buf.readUInt(5);
        for (let i = 0; i < total; i++) {
            /*
             * 大小 (8 bytes)
             * MD5 + MD5S (0x20)
             * nameSize (4 bytes)
             * Name (unicode)
             */
            const size = buf.readULong(ptr + 0);
            const md5 = buf.readHex(ptr + 8, 0x10);
            const md5s = buf.readHex(ptr + 0x18, 0x10);
            const nameSize = buf.readUInt(ptr + 0x28) << 1;
            ptr += 0x2c;
            const path = buf.readUnicode(ptr, nameSize);
            ptr += nameSize;
            arrFiles.push({ md5, md5s, size, path });
        }
        return arrFiles;
    }
    /** 
     * @param {string} szUrl
     * @returns {MD5Info[]}
     */
    static parse梦姬(szUrl) {
        return szUrl
            .split("\n")
            .map(z => z.trim().match(/([\da-f]{9}[\da-z][\da-f]{22})#(?:([\da-f]{32})#)?([\d]{1,20})#([\s\S]+)/iu))
            .filter(Boolean)
            .map((info) => ({
                // 标准码 / 短版标准码(无md5s)
                md5: decryptMd5(info[1].toLowerCase()),
                md5s: (info[2] || "").toLowerCase(),
                size: parseInt(info[3]),
                path: info[4],
            }))
    }
}

/**
 * 一个简单的类似于 NodeJS Buffer 的实现.
 * 用于解析游侠度娘提取码。
 * @param {SimpleBuffer}
 */
class SimpleBuffer {
    constructor(str) {
        this.fromString(str);
    }
    static toStdHex(n) {
        return `0${n.toString(16)}`.slice(-2);
    }
    fromString(str) {
        const len = str.length;
        this.buf = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            this.buf[i] = str.charCodeAt(i);
        }
    }
    readUnicode(index, size) {
        if (size & 1) size++;

        const bufText = Array.prototype.slice
            .call(this.buf, index, index + size)
            .map(SimpleBuffer.toStdHex);
        const buf = [""];
        for (let i = 0; i < size; i += 2) {
            buf.push(bufText[i + 1] + bufText[i]);
        }
        return JSON.parse(`"${buf.join("\\u")}"`);
    }
    readNumber(index, size) {
        let ret = 0;
        for (let i = index + size; i > index;) {
            ret = this.buf[--i] + ret * 256;
        }
        return ret;
    }
    readUInt(index) {
        return this.readNumber(index, 4);
    }
    readULong(index) {
        return this.readNumber(index, 8);
    }
    readHex(index, size) {
        return Array.prototype.slice
            .call(this.buf, index, index + size)
            .map(SimpleBuffer.toStdHex)
            .join("");
    }
}