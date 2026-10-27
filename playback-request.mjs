// Match the native JSONObject boolean overloads: numeric 0/1 change the signed body.
export function playbackPayload(id,single=false){
 if(!/^\d{1,30}$/.test(id))throw Error('分集编号无效');
 const biz_param={detail_page_version:0,device_level:4,disable_digg_stat:false,need_all_video_definition:true,need_mp4_align:false,use_os_player:false,use_server_dns:false,video_platform:1024};
 return JSON.stringify(single?{video_id:id,biz_param}:{biz_param,mixed_video_id_map:{'1004':[id]}});
}
